from pathlib import Path
import os
import shutil
import uuid

import sentencepiece as spm
from transformers import (
    SiglipConfig,
    SiglipImageProcessor,
    SiglipModel,
    SiglipProcessor,
    SiglipTextConfig,
    SiglipTokenizer,
    SiglipVisionConfig,
)


output = Path("collector-models/smoke-base").resolve()
output.mkdir(parents=True, exist_ok=True)
temporary = Path(os.environ.get("SYSTEMROOT", "C:\\Windows")) / "Temp" / f"siglip-smoke-{uuid.uuid4().hex}"
temporary.mkdir(parents=True, exist_ok=True)
corpus = temporary / "corpus.txt"
corpus.write_text(
    "\n".join([
        "一份番茄炒蛋", "一份清炒西兰花", "一份未覆盖菜品",
        "测试餐饮区家常菜档口售卖的番茄炒蛋",
        "测试餐饮区素菜档口售卖的清炒西兰花",
        "其他区域其他档口售卖的未覆盖菜品",
    ]),
    "utf-8",
)
spm.SentencePieceTrainer.train(
    input=str(corpus),
    model_prefix=str(temporary / "spiece"),
    vocab_size=64,
    model_type="unigram",
    character_coverage=1.0,
    hard_vocab_limit=False,
    bos_id=-1,
)
tokenizer = SiglipTokenizer(vocab_file=str(temporary / "spiece.model"), model_max_length=64)
image_processor = SiglipImageProcessor(
    size={"height": 32, "width": 32},
    image_mean=[0.5, 0.5, 0.5],
    image_std=[0.5, 0.5, 0.5],
)
processor = SiglipProcessor(image_processor=image_processor, tokenizer=tokenizer)
text_config = SiglipTextConfig(
    vocab_size=tokenizer.vocab_size,
    hidden_size=64,
    intermediate_size=128,
    num_hidden_layers=2,
    num_attention_heads=4,
    max_position_embeddings=64,
    projection_size=768,
)
vision_config = SiglipVisionConfig(
    hidden_size=768,
    intermediate_size=256,
    num_hidden_layers=3,
    num_attention_heads=12,
    image_size=32,
    patch_size=16,
)
model = SiglipModel(SiglipConfig(
    text_config=text_config.to_dict(),
    vision_config=vision_config.to_dict(),
    projection_dim=768,
))
model.save_pretrained(output)
processor.save_pretrained(output)
shutil.rmtree(temporary)
print({"ok": True, "output": str(output), "dimension": 768})
