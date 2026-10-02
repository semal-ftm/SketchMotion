import sys
from pathlib import Path

# Make `import app` work when pytest is run from the backend folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
