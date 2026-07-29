import argparse
import json
import math
import os
import random
from collections import defaultdict
from contextlib import nullcontext
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageEnhance, ImageFilter
from torch import nn
from torch.utils.data import DataLoader, Dataset, Sampler
from transformers import AutoProcessor, SiglipModel


BASE_MODEL = "google/siglip-base-patch16-224"
GATE_THRESHOLDS = {
    "dish_macro_top1": 0.80,
    "dish_macro_top3": 0.92,
    "canonical_macro_top1": 0.90,
    "canonical_macro_top3": 0.97,
    "same_name_stall_recall_at3": 0.95,
    "unknown_false_accept_rate": 0.05,
    "top1_improvement": 0.08,
}


def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune SigLIP for campus dish retrieval")
    parser.add_argument("--dataset", required=True, help="Versioned collector dataset directory")
    parser.add_argument("--output", required=True, help="Model version output directory")
    parser.add_argument("--base-model", default=BASE_MODEL)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--effective-batch-size", type=int, default=64)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--skip-baseline", action="store_true")
    return parser.parse_args()


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def load_manifest(dataset_dir, smoke=False):
    manifest_path = dataset_dir / "manifest.jsonl"
    records = [json.loads(line) for line in manifest_path.read_text("utf-8").splitlines() if line.strip()]
    for record in records:
        record["absolute_image"] = str((dataset_dir / record["image"]).resolve())
    required = {"train", "validation", "test"}
    present = {record["split"] for record in records}
    if not required.issubset(present):
        raise ValueError(f"manifest must include {sorted(required)} splits")
    quotas = {"train": 1, "validation": 1, "test": 1} if smoke else {"train": 40, "validation": 10, "test": 10}
    if any(sum(1 for item in records if item["dish_id"] == dish and item["split"] == split) < quota
           for dish in {item["dish_id"] for item in records if item["split"] == "train"}
           for split, quota in quotas.items()):
        raise ValueError("every dish must satisfy the required train, validation, and test quotas")
    return records


def augment_image(image, rng):
    width, height = image.size
    scale = rng.uniform(0.86, 1.0)
    crop_w, crop_h = max(1, int(width * scale)), max(1, int(height * scale))
    left = rng.randint(0, max(0, width - crop_w))
    top = rng.randint(0, max(0, height - crop_h))
    image = image.crop((left, top, left + crop_w, top + crop_h)).resize((width, height), Image.Resampling.BICUBIC)
    image = image.rotate(rng.uniform(-7, 7), resample=Image.Resampling.BICUBIC, fillcolor=(235, 235, 235))
    image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.82, 1.18))
    image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.88, 1.12))
    channels = list(image.split())
    red = ImageEnhance.Brightness(channels[0]).enhance(rng.uniform(0.94, 1.06))
    blue = ImageEnhance.Brightness(channels[2]).enhance(rng.uniform(0.94, 1.06))
    image = Image.merge("RGB", (red, channels[1], blue))
    if rng.random() < 0.25:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 1.1)))
    if rng.random() < 0.3:
        dx, dy = int(width * rng.uniform(-0.025, 0.025)), int(height * rng.uniform(-0.025, 0.025))
        image = image.transform(image.size, Image.Transform.AFFINE, (1, rng.uniform(-0.025, 0.025), dx, rng.uniform(-0.02, 0.02), 1, dy), resample=Image.Resampling.BICUBIC, fillcolor=(235, 235, 235))
    return image


class DishDataset(Dataset):
    def __init__(self, records, processor, labels, training=False, seed=42):
        self.records = records
        self.processor = processor
        self.labels = labels
        self.training = training
        self.seed = seed
        self.epoch = 0

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        with Image.open(record["absolute_image"]) as source:
            image = source.convert("RGB")
        if self.training:
            image = augment_image(image, random.Random(self.seed + self.epoch * 1_000_003 + index))
        return image, record, self.labels.get(record["dish_id"], -1)

    def collate(self, items):
        images, records, labels = zip(*items)
        texts = [prompt for record in records for prompt in (record["prompt_generic"], record["prompt_instance"])]
        image_inputs = self.processor(images=list(images), return_tensors="pt")
        text_inputs = self.processor(text=texts, padding="max_length", truncation=True, return_tensors="pt")
        return {
            "pixel_values": image_inputs["pixel_values"],
            "input_ids": text_inputs["input_ids"],
            "attention_mask": text_inputs["attention_mask"],
            "labels": torch.tensor(labels, dtype=torch.long),
            "records": records,
        }


class HardNegativeBatchSampler(Sampler):
    def __init__(self, records, batch_size, seed):
        self.records = records
        self.batch_size = batch_size
        self.seed = seed
        self.epoch = 0
        buckets = defaultdict(lambda: defaultdict(list))
        for index, record in enumerate(records):
            buckets[record["canonical_name"]][record["dish_id"]].append(index)
        self.hard_buckets = [bucket for bucket in buckets.values() if len(bucket) > 1]

    def __len__(self):
        return math.ceil(len(self.records) / self.batch_size)

    def __iter__(self):
        rng = random.Random(self.seed + self.epoch)
        remaining = set(range(len(self.records)))
        while remaining:
            batch = []
            viable = []
            for bucket in self.hard_buckets:
                dish_groups = [[index for index in indices if index in remaining] for indices in bucket.values()]
                dish_groups = [indices for indices in dish_groups if indices]
                if len(dish_groups) > 1:
                    viable.append(dish_groups)
            if viable and len(remaining) >= 2:
                groups = rng.choice(viable)
                first, second = rng.sample(groups, 2)
                batch.extend([rng.choice(first), rng.choice(second)])
            for index in batch:
                remaining.discard(index)
            fill = min(self.batch_size - len(batch), len(remaining))
            if fill:
                extra = rng.sample(list(remaining), fill)
                batch.extend(extra)
                remaining.difference_update(extra)
            yield batch


class FineTuneModel(nn.Module):
    def __init__(self, base_model, classes):
        super().__init__()
        self.backbone = SiglipModel.from_pretrained(base_model)
        projection_dim = int(self.backbone.config.vision_config.hidden_size)
        self.classifier = nn.Linear(projection_dim, classes)
        for parameter in self.backbone.parameters():
            parameter.requires_grad = False
        layers = self.backbone.vision_model.encoder.layers
        for layer in layers[-2:]:
            for parameter in layer.parameters():
                parameter.requires_grad = True
        projection_module = getattr(self.backbone, "visual_projection", None) or self.backbone.vision_model.head
        for parameter in projection_module.parameters():
            parameter.requires_grad = True
        self.backbone.logit_scale.requires_grad = True
        if getattr(self.backbone, "logit_bias", None) is not None:
            self.backbone.logit_bias.requires_grad = True

    def image_features(self, pixel_values):
        vector = self.backbone.get_image_features(pixel_values=pixel_values)
        return F.normalize(vector, dim=-1)

    def text_features(self, input_ids, attention_mask):
        with torch.no_grad():
            vector = self.backbone.get_text_features(input_ids=input_ids, attention_mask=attention_mask)
        return F.normalize(vector, dim=-1)

    def forward(self, pixel_values, input_ids, attention_mask):
        image_vectors = self.image_features(pixel_values)
        text_vectors = self.text_features(input_ids, attention_mask)
        scale = self.backbone.logit_scale.exp().clamp(max=100)
        logits = image_vectors @ text_vectors.T * scale
        if getattr(self.backbone, "logit_bias", None) is not None:
            logits = logits + self.backbone.logit_bias
        signs = torch.full_like(logits, -1)
        rows = torch.arange(image_vectors.shape[0], device=logits.device)
        signs[rows, rows * 2] = 1
        signs[rows, rows * 2 + 1] = 1
        siglip_loss = -F.logsigmoid(signs * logits).mean()
        return image_vectors, siglip_loss


def macro_topk(scores, truths, labels, k):
    predictions = torch.topk(scores, k=min(k, scores.shape[1]), dim=1).indices.cpu().numpy()
    truth_values = np.asarray(truths)
    per_class = []
    for label in sorted(set(truths)):
        indices = np.where(truth_values == label)[0]
        per_class.append(np.mean([label in predictions[index] for index in indices]))
    return float(np.mean(per_class)) if per_class else 0.0


@torch.inference_mode()
def embed_records(model, processor, records, labels, device, workers, batch_size):
    dataset = DishDataset(records, processor, labels, training=False)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=workers, collate_fn=dataset.collate)
    vectors = []
    for batch in loader:
        vectors.append(model.image_features(batch["pixel_values"].to(device)).cpu())
    return torch.cat(vectors, dim=0)


def build_prototypes(vectors, records, dish_ids):
    result = []
    for dish_id in dish_ids:
        indices = [index for index, record in enumerate(records) if record["dish_id"] == dish_id]
        result.append(F.normalize(vectors[indices].mean(dim=0), dim=0))
    return torch.stack(result)


def evaluate(model, processor, train_records, eval_records, labels, dish_ids, device, workers, batch_size):
    train_vectors = embed_records(model, processor, train_records, labels, device, workers, batch_size)
    eval_vectors = embed_records(model, processor, eval_records, labels, device, workers, batch_size)
    prototypes = build_prototypes(train_vectors, train_records, dish_ids)
    scores = eval_vectors @ prototypes.T
    truths = [labels[record["dish_id"]] for record in eval_records]
    dish_top1 = macro_topk(scores, truths, dish_ids, 1)
    dish_top3 = macro_topk(scores, truths, dish_ids, 3)

    canonical_names = sorted({record["canonical_name"] for record in train_records})
    canonical_to_index = {name: index for index, name in enumerate(canonical_names)}
    dish_canonical = {record["dish_id"]: record["canonical_name"] for record in train_records}
    canonical_scores = torch.stack([torch.max(scores[:, [index for index, dish_id in enumerate(dish_ids) if dish_canonical[dish_id] == name]], dim=1).values for name in canonical_names], dim=1)
    canonical_truths = [canonical_to_index[record["canonical_name"]] for record in eval_records]
    canonical_top1 = macro_topk(canonical_scores, canonical_truths, canonical_names, 1)
    canonical_top3 = macro_topk(canonical_scores, canonical_truths, canonical_names, 3)
    duplicate_names = {name for name in canonical_names if sum(1 for dish_id in dish_ids if dish_canonical[dish_id] == name) > 1}
    duplicate_indices = [index for index, record in enumerate(eval_records) if record["canonical_name"] in duplicate_names]
    top3 = torch.topk(scores, k=min(3, scores.shape[1]), dim=1).indices.cpu().numpy()
    stall_recall = float(np.mean([truths[index] in top3[index] for index in duplicate_indices])) if duplicate_indices else 0.0
    return {
        "dish_macro_top1": dish_top1,
        "dish_macro_top3": dish_top3,
        "canonical_macro_top1": canonical_top1,
        "canonical_macro_top3": canonical_top3,
        "same_name_stall_recall_at3": stall_recall,
        "max_scores": torch.max(scores, dim=1).values.cpu().tolist(),
        "correct_top1": (torch.argmax(scores, dim=1).cpu() == torch.tensor(truths)).tolist(),
    }, prototypes


def calibrated_threshold(validation_metrics):
    pairs = sorted(zip(validation_metrics["max_scores"], validation_metrics["correct_top1"]), reverse=True)
    accepted = errors = 0
    threshold = 1.0
    for score, correct in pairs:
        accepted += 1
        errors += int(not correct)
        if accepted >= 20 and errors / accepted <= 0.05:
            threshold = score
    return float(threshold)


def deployment_gate(metrics):
    checks = {
        "dish_top1": metrics["dish_macro_top1"] >= GATE_THRESHOLDS["dish_macro_top1"],
        "dish_top3": metrics["dish_macro_top3"] >= GATE_THRESHOLDS["dish_macro_top3"],
        "canonical_top1": metrics["canonical_macro_top1"] >= GATE_THRESHOLDS["canonical_macro_top1"],
        "canonical_top3": metrics["canonical_macro_top3"] >= GATE_THRESHOLDS["canonical_macro_top3"],
        "same_name_stall_recall": metrics["same_name_stall_recall_at3"] >= GATE_THRESHOLDS["same_name_stall_recall_at3"],
        "unknown_false_accept": metrics.get("unknown_false_accept_rate") is not None and metrics["unknown_false_accept_rate"] <= GATE_THRESHOLDS["unknown_false_accept_rate"],
        "baseline_improvement": metrics.get("top1_improvement") is not None and metrics["top1_improvement"] >= GATE_THRESHOLDS["top1_improvement"],
    }
    return checks, all(checks.values())


def main():
    args = parse_args()
    seed_everything(args.seed)
    dataset_dir, output_dir = Path(args.dataset).resolve(), Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    records = load_manifest(dataset_dir, smoke=args.smoke)
    if args.smoke:
        args.epochs, args.patience = min(args.epochs, 2), 1
    train_records = [record for record in records if record["split"] == "train"]
    validation_records = [record for record in records if record["split"] == "validation"]
    test_records = [record for record in records if record["split"] == "test"]
    unknown_records = [record for record in records if record["split"] == "unknown"]
    dish_ids = sorted({record["dish_id"] for record in train_records})
    labels = {dish_id: index for index, dish_id in enumerate(dish_ids)}
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    processor = AutoProcessor.from_pretrained(args.base_model)
    model = FineTuneModel(args.base_model, len(dish_ids)).to(device)
    train_dataset = DishDataset(train_records, processor, labels, training=True, seed=args.seed)
    sampler = HardNegativeBatchSampler(train_records, args.batch_size, args.seed)
    loader = DataLoader(train_dataset, batch_sampler=sampler, num_workers=args.workers, collate_fn=train_dataset.collate)
    accumulation = max(1, math.ceil(args.effective_batch_size / args.batch_size))
    backbone_parameters = [parameter for name, parameter in model.named_parameters() if parameter.requires_grad and not name.startswith("classifier") and "visual_projection" not in name and "vision_model.head" not in name and "logit_" not in name]
    backbone_parameter_ids = {id(parameter) for parameter in backbone_parameters}
    head_parameters = [parameter for _, parameter in model.named_parameters() if parameter.requires_grad and id(parameter) not in backbone_parameter_ids]
    optimizer = torch.optim.AdamW([{"params": backbone_parameters, "lr": 1e-5}, {"params": head_parameters, "lr": 1e-4}], weight_decay=0.01)
    amp_enabled = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    best_score, stale_epochs = -1.0, 0
    history = []
    checkpoint_dir = output_dir / "checkpoint"

    for epoch in range(args.epochs):
        model.train()
        model.backbone.text_model.eval()
        train_dataset.epoch = sampler.epoch = epoch
        optimizer.zero_grad(set_to_none=True)
        running = 0.0
        for step, batch in enumerate(loader):
            context = torch.autocast(device_type="cuda", dtype=torch.float16) if amp_enabled else nullcontext()
            with context:
                vectors, siglip_loss = model(batch["pixel_values"].to(device), batch["input_ids"].to(device), batch["attention_mask"].to(device))
                classification_loss = F.cross_entropy(model.classifier(vectors), batch["labels"].to(device))
                loss = (siglip_loss + 0.3 * classification_loss) / accumulation
            scaler.scale(loss).backward()
            if (step + 1) % accumulation == 0 or step + 1 == len(loader):
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
            running += float(loss.item() * accumulation)
        model.eval()
        validation_metrics, _ = evaluate(model, processor, train_records, validation_records, labels, dish_ids, device, args.workers, args.batch_size)
        score = validation_metrics["dish_macro_top1"]
        history.append({"epoch": epoch + 1, "loss": running / max(1, len(loader)), "validation_macro_top1": score})
        print(json.dumps(history[-1], ensure_ascii=False), flush=True)
        if score > best_score + 1e-6:
            best_score, stale_epochs = score, 0
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            model.backbone.save_pretrained(checkpoint_dir)
            processor.save_pretrained(checkpoint_dir)
            torch.save({"classifier": model.classifier.state_dict(), "labels": labels}, output_dir / "training_head.pt")
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                break

    best_backbone = SiglipModel.from_pretrained(checkpoint_dir).to(device).eval()
    model.backbone = best_backbone
    validation_metrics, prototypes = evaluate(model, processor, train_records, validation_records, labels, dish_ids, device, args.workers, args.batch_size)
    test_metrics, prototypes = evaluate(model, processor, train_records, test_records, labels, dish_ids, device, args.workers, args.batch_size)
    threshold = calibrated_threshold(validation_metrics)
    test_metrics["auto_confirm_threshold"] = threshold
    if unknown_records:
        unknown_vectors = embed_records(model, processor, unknown_records, labels, device, args.workers, args.batch_size)
        unknown_scores = unknown_vectors @ prototypes.T
        test_metrics["unknown_false_accept_rate"] = float((torch.max(unknown_scores, dim=1).values >= threshold).float().mean())
    else:
        test_metrics["unknown_false_accept_rate"] = None

    if not args.skip_baseline:
        baseline = FineTuneModel(args.base_model, len(dish_ids)).to(device).eval()
        baseline_metrics, _ = evaluate(baseline, processor, train_records, test_records, labels, dish_ids, device, args.workers, args.batch_size)
        test_metrics["baseline_dish_macro_top1"] = baseline_metrics["dish_macro_top1"]
        test_metrics["top1_improvement"] = test_metrics["dish_macro_top1"] - baseline_metrics["dish_macro_top1"]
        del baseline
    else:
        test_metrics["top1_improvement"] = None

    checks, deployable = deployment_gate(test_metrics)
    metadata_by_dish = {record["dish_id"]: record for record in train_records}
    prototype_payload = []
    for index, dish_id in enumerate(dish_ids):
        metadata = metadata_by_dish[dish_id]
        prototype_payload.append({"dish_id": dish_id, "canonical_name": metadata["canonical_name"], "dish_name": metadata["dish_name"], "venue": metadata["venue"], "stall": metadata["stall"], "image_count": sum(1 for item in train_records if item["dish_id"] == dish_id), "dimension": int(prototypes.shape[1]), "embedding": prototypes[index].cpu().float().tolist()})
    (output_dir / "prototypes.json").write_text(json.dumps(prototype_payload, ensure_ascii=False), "utf-8")
    metrics_payload = {key: value for key, value in test_metrics.items() if key not in {"max_scores", "correct_top1"}}
    deployment = {"modelVersion": output_dir.name, "baseModel": args.base_model, "dimension": int(prototypes.shape[1]), "dataset": dataset_dir.name, "deployable": deployable, "checks": checks, "metrics": metrics_payload, "history": history, "checkpoint": str(checkpoint_dir)}
    (output_dir / "deployment.json").write_text(json.dumps(deployment, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({"deployable": deployable, "checks": checks, "metrics": metrics_payload}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
