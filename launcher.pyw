"""配布版の起動（スタートメニューのショートカットから、conda 環境の pythonw.exe で動かす）。中身は app/launcher.py。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.launcher import main  # noqa: E402

main()
