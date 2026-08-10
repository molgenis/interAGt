

<p align="center">
<img src="resources/logo_interAGt.svg" alt="logo" width="60%" />
</p>

## **InterAGt: An interactive interface for predicting genetic variant effects using AlphaGenome**
![](resources//interAGt.gif)
## **About**

InterAGt provides an intuitive way to **visualize and interpret the functional impact of genetic variants** using [AlphaGenome](https://www.alphagenomedocs.com), Google DeepMind's state-of-the-art model for predicting regulatory effects from DNA sequences.

**Supported input formats:**
- **HGVS notation** (e.g., `NC_000001.11:g.169549811C>T`)
- **SNP IDs (rsIDs)** (e.g., `rs1234567`)
- **Genomic coordinates** (e.g., `chr1:169549811:C:T`)

AlphaGenome analyzes sequences up to **1 million base pairs** and predicts **11 types of genomic tracks** (e.g., gene expression, chromatin accessibility, splicing) across thousands of tissue and cell-type contexts.

By inputting a variant, researchers can:
- Compare **reference vs. alternative allele tracks** for any variant
- Analyze impacts on **RNA-seq, ATAC, ChIP-seq, splicing, and more**
- Select from **ontology-annotated tissues/cell types** (e.g., `UBERON:0002048` for lung)
- **No coding required**: Access cutting-edge predictions through a user-friendly interface


## **References**
- Žiga Avsec, Natasha Latysheva, Jun Cheng, *et al.* **Advancing regulatory variant effect prediction with AlphaGenome.** *Nature*, 649(8099):1206–1218, 2026. [DOI:10.1038/s41586-025-10014-0](https://doi.org/10.1038/s41586-025-10014-0)

For more details, see the [AlphaGenome Documentation](https://www.alphagenomedocs.com)


## **Setup & Installation**

### **Option 1: Pre-built Binaries**
The easiest way to get started is to use one of the pre-compiled executables. No Python, Bun, or additional dependencies are required.

Pre-compiled binaries for Windows, macOS, and Linux are available at **[INSERT DOWNLOAD LOCATION HERE]**.

After downloading:

Extract the archive.
Launch the executable and the app will open in its own window (backed by `http://localhost:8000`).

---
### **Option 2: Run Directly (Recommended for Development)**

**Prerequisites:**
- Python 3.12+
- [Bun](https://bun.sh/) (for frontend development)

**Run in production mode:**
```bash
python app_launcher.py
```

**Run in preview mode** (serves the last built frontend on its own port, no rebuild needed):
```bash
python app_launcher.py --dev
```

Both open a native app window (via `pywebview`), backed by:
- Production: `http://localhost:8000`
- Preview: Frontend at `http://localhost:4173`, Backend at `http://localhost:8000`

For live frontend reload (HMR) while editing, run the frontend and backend dev servers directly instead:
```bash
cd frontend && bun run dev       # http://localhost:5173, hot reload
.venv/bin/uvicorn backend.main:app --reload   # http://localhost:8000
```

---

### **Option 3: Install via PyInstaller (Standalone Executable)**

**Prerequisites:**
- Python 3.12+
- PyInstaller: `pip install pyinstaller`

**Linux/macOS:**
```bash
./build_script.sh
```
Produces `dist/InterAGt.app` (and `dist/InterAGt/` unbundled).

**Windows:**
```powershell
.\build_win.ps1
```
Produces `dist\InterAGt\InterAGt.exe`.

**To wrap the build into an installer** (`dist/InterAGt.dmg` on macOS via `hdiutil`, `dist\InterAGt-Setup.exe` on Windows via [Inno Setup 6](https://jrsoftware.org/isdl.php)):
```bash
./package_mac.sh       # macOS
.\package_win.ps1      # Windows
```
These builds are unsigned — macOS Gatekeeper / Windows SmartScreen will warn on first launch.

---

### **Option 4: Manual Setup**

For manual setup:

```bash
# Clone the repository
git clone https://github.com/Timniem/ag_streamlit_app
cd ag_streamlit_app

# Install dependencies
pip install --upgrade pip
pip install -r backend/requirements.txt

# Build frontend
cd frontend
bun install
bun run build

# Run the app
cd ..
python app_launcher.py
```