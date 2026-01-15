import sys
import subprocess

def install(package):
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])

try:
    from docx import Document
except ImportError:
    print("python-docx not found, installing...")
    install("python-docx")
    from docx import Document

def read_docx(file_path):
    doc = Document(file_path)
    fullText = []
    for para in doc.paragraphs:
        fullText.append(para.text)
    return '\n'.join(fullText)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python read_docx.py <path_to_docx>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    try:
        content = read_docx(file_path)
        # Handle potential encoding issues in windows console
        sys.stdout.reconfigure(encoding='utf-8')
        print(content)
    except Exception as e:
        print(f"Error reading file: {e}")
