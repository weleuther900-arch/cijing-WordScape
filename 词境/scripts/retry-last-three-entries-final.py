"""Write the final direct override after legacy example files in glob order."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("retry_final", ROOT / "scripts" / "retry-final-held-entries.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)
module.OUTPUT = ROOT / "data" / "self-authored-examples~final-retry.js"
module.main()
