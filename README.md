![title](resources/logo_interAGt.svg)

**A user-friendly interface for analyzing genetic variant effects using Google DeepMind's AlphaGenome API**

---

## **About**
This Streamlit app provides an intuitive way to **visualize and interpret the functional impact of genetic variants** using [AlphaGenome](https://www.alphagenomedocs.com), Google DeepMind’s state-of-the-art model for predicting regulatory effects from DNA sequences. AlphaGenome analyzes sequences up to **1 million base pairs** and predicts **11 types of genomic tracks** (e.g., gene expression, chromatin accessibility, splicing) across thousands of tissue and cell-type contexts.

By inputting a variant (e.g., `chr1:169549811:C:T`), researchers can:
- Compare **reference vs. alternative allele tracks** for any variant.
- Analyze impacts on **RNA-seq, ATAC, ChIP-seq, splicing, and more**.
- Select from **ontology-annotated tissues/cell types** (e.g., `UBERON:0002048` for lung).
- **No coding required**: Access cutting-edge predictions through a user-friendly interface.

---

## **References**
- Žiga Avsec, Natasha Latysheva, Jun Cheng, *et al.* **Advancing regulatory variant effect prediction with AlphaGenome.** *Nature*, 649(8099):1206–1218, 2026. [DOI:10.1038/s41586-025-10014-0](https://doi.org/10.1038/s41586-025-10014-0).

For more details, see the [AlphaGenome Documentation](https://www.alphagenomedocs.com).

---

---

## **Setup Instructions**

### **1. Prerequisites**
- **Python 3.9 or later** (recommended: Python 3.10+)
- **pip** (Python package manager)


---

### **2. Clone the Repository**
```bash
git clone https://github.com/Timniem/ag_streamlit_app
cd ag_streamlit_app
```

### **3. Install the required Python Packages**

We recommend to do this in a venv/conda/mamba environment.

```bash
pip install --upgrade pip
pip install streamlit plotly numpy alphagenome
```

### **4. Run a streamlit server**

Run the app:

(optional) activate the virtual environment

```bash
streamlit run main.py
```
or when this gives an error:
```bash
python -m streamlit run main.py
```

