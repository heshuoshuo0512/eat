import importlib.util
import os
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(os.environ.get(
    "REAL_CATALOG_SOURCE_DIR",
    r"D:\Mywechatlog\xwechat_files\wxid_06l166che9wp22_76f7\msg\file\2026-07",
))
MODULE_PATH = ROOT / "scripts" / "normalize-real-catalog.py"
SPEC = importlib.util.spec_from_file_location("real_catalog_normalizer", MODULE_PATH)
normalizer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = normalizer
SPEC.loader.exec_module(normalizer)


def source_files_available():
    return all((SOURCE_DIR / source.filename).exists() for source in normalizer.CATALOGS["campus"].sources)


def parse_catalog(key):
    catalog = normalizer.CATALOGS[key]
    normalizer.DATA_VERSION = catalog.data_version
    stalls, dishes, audits = [], [], []
    for source in catalog.sources:
        path = SOURCE_DIR / source.filename
        if source.format == "xlsx":
            normalizer.parse_xlsx_source(path, source, stalls, dishes, audits)
        elif source.format == "docx":
            normalizer.parse_docx_source(path, source, stalls, dishes, audits)
        else:
            normalizer.parse_text_source(path, source, stalls, dishes, audits)
    return catalog, stalls, dishes, audits


@unittest.skipUnless(source_files_available(), "real catalog source files are not available")
class RealCatalogNormalizerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.west = parse_catalog("west-main")
        cls.campus = parse_catalog("campus")

    def test_west_regression_counts_are_unchanged(self):
        _, stalls, dishes, audits = self.west
        self.assertEqual(len(stalls), 78)
        self.assertEqual(len(dishes), 1616)
        self.assertEqual(sum(row["status"] == "review_required" for row in audits), 87)

    def test_combined_hierarchy_and_east_stall_counts(self):
        catalog, stalls, _, _ = self.campus
        self.assertEqual(len(normalizer.build_canteens(catalog)), 12)
        self.assertEqual(len(stalls), 138)
        counts = {
            area_id: sum(stall["canteenId"] == area_id for stall in stalls)
            for area_id in ("east-yanminghu-1f", "east-yanminghu-2f", "east-dongdahuo", "east-guangyuan")
        }
        self.assertEqual(counts, {
            "east-yanminghu-1f": 17,
            "east-yanminghu-2f": 20,
            "east-dongdahuo": 6,
            "east-guangyuan": 17,
        })

    def test_service_buildings_do_not_create_zero_price_placeholders(self):
        _, stalls, dishes, _ = self.campus
        stall_by_id = {stall["id"]: stall for stall in stalls}
        dongdahuo_ids = {stall["id"] for stall in stalls if stall["canteenId"] == "east-dongdahuo"}
        self.assertFalse(any(dish["stallId"] in dongdahuo_ids for dish in dishes))
        self.assertTrue(all(dish["price"] > 0 for dish in dishes))
        for chain in ("蜜雪冰城", "幸运咖"):
            matches = [stall for stall in stalls if stall["name"] == chain]
            self.assertGreaterEqual(len(matches), 2)
            self.assertEqual(len({stall["id"] for stall in matches}), len(matches))
            self.assertGreaterEqual(len({stall["canteenId"] for stall in matches}), 2)
        self.assertTrue(all(stall_by_id[dish["stallId"]]["canteenId"] != "east-dongdahuo" for dish in dishes))

    def test_guangyuan_priced_and_unpriced_products_are_separated(self):
        _, stalls, dishes, audits = self.campus
        guangyuan_stalls = [stall for stall in stalls if stall["canteenId"] == "east-guangyuan"]
        duck = next(stall for stall in guangyuan_stalls if stall["name"] == "鸭货")
        priced = [dish for dish in dishes if dish["stallId"] == duck["id"]]
        self.assertEqual(len(priced), 21)
        self.assertEqual(sum(dish["pricingMode"] == "per_weight" for dish in priced), 9)
        self.assertEqual(sum(dish["pricingMode"] == "per_unit" for dish in priced), 12)
        review_stall_ids = {stall["id"] for stall in guangyuan_stalls if stall["name"] in {"喜悦冰糖葫芦", "好滋味"}}
        unpriced = [
            row for row in audits
            if row["status"] == "review_required" and row.get("normalized", {}).get("stallId") in review_stall_ids
        ]
        self.assertEqual(len(unpriced), 11)
        yihetang = next(stall for stall in guangyuan_stalls if stall["name"] == "益和堂")
        self.assertIn("益禾堂", yihetang["aliases"])
        generic = next(stall for stall in guangyuan_stalls if stall["name"] == "超市")
        self.assertEqual(generic["category"], "名称待核验")

    def test_yanminghu_variants_and_weight_pricing_keep_product_names(self):
        _, stalls, dishes, audits = self.campus
        stall_by_id = {stall["id"]: stall for stall in stalls}
        floor2 = [dish for dish in dishes if stall_by_id[dish["stallId"]]["canteenId"] == "east-yanminghu-2f"]
        self.assertFalse(any(dish["name"] in {"小份", "大份"} for dish in dishes))
        self.assertTrue(any("水饺" in dish["name"] for dish in floor2))
        self.assertTrue(any("锅贴" in dish["name"] for dish in floor2))
        weighted = next(dish for dish in floor2 if dish["name"] == "自选烤盘饭")
        self.assertEqual(weighted["priceDisplay"], "9.9元/4两")
        sandstone = next(dish for dish in floor2 if dish["name"] == "砂锅土豆粉")
        self.assertEqual([variant["label"] for variant in sandstone["pricing"]["variants"]], ["酥肉锅", "肉卷锅", "丸子锅", "香肠锅", "普通锅"])
        self.assertTrue(any(row["status"] == "review_required" and "泡椒郡花酸辣粉" in row["rawText"] for row in audits))


if __name__ == "__main__":
    unittest.main()
