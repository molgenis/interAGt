

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
Launch the executable and the program will open at: http://localhost:8000.

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

The app will be available at:
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
The executable will be created in the `dist/` directory.

**Windows:**
```powershell
.\build_win.ps1
```
The executable will be created as `dist\AGInterpret.exe`.

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