from html.parser import HTMLParser
from pathlib import Path
from textwrap import wrap

SOURCE = Path(r"C:\Users\DELL\Downloads\Major Project\AeroHealth_Project_Explanation.html")
OUTPUT = Path(r"C:\Users\DELL\Downloads\Major Project\AeroHealth_Project_Explanation.pdf")

class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.current = []
        self.tag = None
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag in {"style", "script"}:
            self.skip = True
            return
        if self.skip:
            return
        if tag in {"h1", "h2", "h3", "h4", "p", "li", "pre"}:
            if self.current:
                self.finish()
            self.tag = tag
            self.current = []
        elif tag == "br" and self.current:
            self.current.append("\n")

    def handle_endtag(self, tag):
        if tag in {"style", "script"}:
            self.skip = False
            return
        if self.skip:
            return
        if tag in {"h1", "h2", "h3", "h4", "p", "li", "pre"} and self.tag == tag:
            self.finish()

    def handle_data(self, data):
        if not self.skip and self.tag:
            self.current.append(data)

    def finish(self):
        text = " ".join("".join(self.current).split())
        if text:
            self.blocks.append((self.tag, text))
        self.current = []
        self.tag = None

parser = ReportParser()
parser.feed(SOURCE.read_text(encoding="utf-8"))
parser.finish()

PAGE_W, PAGE_H = 595, 842
LEFT, RIGHT, TOP, BOTTOM = 48, 48, 52, 52
FONT = "F1"
BOLD = "F2"
MONO = "F3"

pages = []
lines = []
y = PAGE_H - TOP

# Keep the report readable in a simple, portable PDF.
def add_line(text, size=10, font=FONT, color=(0.10, 0.13, 0.16), gap=14):
    global y, lines
    if y < BOTTOM + 28:
        pages.append(lines)
        lines = []
        y = PAGE_H - TOP
    lines.append((LEFT, y, text, size, font, color))
    y -= gap

def add_wrapped(text, size=10, font=FONT, color=(0.10, 0.13, 0.16), gap=14, indent=0):
    max_chars = max(35, int((PAGE_W - LEFT - RIGHT - indent) / (size * 0.52)))
    for part in wrap(text, width=max_chars, break_long_words=False, break_on_hyphens=False):
        add_line(part, size, font, color, gap)

for tag, text in parser.blocks:
    if tag == "h1":
        add_line(text, 27, BOLD, (0.08, 0.20, 0.23), 34)
    elif tag == "h2":
        if y < BOTTOM + 100:
            pages.append(lines); lines = []; y = PAGE_H - TOP
        y -= 8
        add_line(text, 17, BOLD, (0.08, 0.35, 0.36), 24)
    elif tag == "h3":
        y -= 3
        add_line(text, 12, BOLD, (0.04, 0.42, 0.43), 18)
    elif tag == "h4":
        add_line(text, 10, BOLD, (0.08, 0.20, 0.23), 15)
    elif tag == "li":
        add_wrapped("- " + text, 9.5, FONT, gap=13, indent=10)
    elif tag == "pre":
        add_wrapped(text, 8.2, MONO, (0.12, 0.20, 0.22), gap=11)
        y -= 3
    else:
        add_wrapped(text, 9.5, FONT, gap=13)
        y -= 3
if lines:
    pages.append(lines)


def esc(value):
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def content_for(page_lines):
    chunks = ["q"]
    for x, yy, text, size, font, color in page_lines:
        r, g, b = color
        chunks.append(f"{r:.3f} {g:.3f} {b:.3f} rg")
        chunks.append(f"/{font} {size} Tf")
        chunks.append(f"{x} {yy:.1f} Td")
        chunks.append(f"({esc(text)}) Tj")
        chunks.append(f"{-x} {-yy:.1f} Td")
    chunks.append("Q")
    return "\n".join(chunks).encode("latin-1", "replace")

objects = []
def obj(data):
    objects.append(data)
    return len(objects)

font_regular = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
font_bold = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
font_mono = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
page_ids = []
content_ids = []
for page_lines in pages:
    stream = content_for(page_lines)
    content_ids.append(obj(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"))
    page_ids.append(obj(b""))

pages_id = obj(b"<< /Type /Pages /Kids [] /Count 0 >>")
for i, page_id in enumerate(page_ids):
    page_data = (f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                 f"/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R /F3 {font_mono} 0 R >> >> "
                 f"/Contents {content_ids[i]} 0 R >>").encode()
    objects[page_id - 1] = page_data
kids = " ".join(f"{pid} 0 R" for pid in page_ids)
objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()
catalog_id = obj(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode())

pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = [0]
for number, data in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{number} 0 obj\n".encode())
    pdf.extend(data)
    pdf.extend(b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects)+1}\n".encode())
pdf.extend(b"0000000000 65535 f \n")
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size {len(objects)+1} /Root {catalog_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
OUTPUT.write_bytes(pdf)
print(f"Created {OUTPUT}")
print(f"Pages: {len(pages)}")
print(f"Bytes: {len(pdf)}")
