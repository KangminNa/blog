# 문서 · 표 · 도표

## 문서 (python-docx → PDF)

```python
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

doc = Document()                          # 재료의 .docx를 고칠 때는 Document("../inputs/이름.docx")
style = doc.styles["Normal"]
style.font.name = "Noto Sans CJK KR"
style.font.size = Pt(11)
style.element.rPr.rFonts.set(qn("w:eastAsia"), "Noto Sans CJK KR")   # 한글은 eastAsia 글꼴을 따로 정한다

doc.add_heading("제목", level=0)
doc.add_heading("1. 요약", level=1)
doc.add_paragraph("본문")
doc.add_paragraph("항목", style="List Bullet")
table = doc.add_table(rows=1, cols=3)
table.style = "Table Grid"
doc.add_picture("chart.png")
doc.save("보고서.docx")
```

제목 스타일(Heading 1 등)에도 한글 글꼴이 필요하면 같은 방법으로 `doc.styles["Heading 1"]`에 정한다.
PDF: `soffice --headless --convert-to pdf --outdir preview 보고서.docx`. 확인은 `pdftoppm -png -r 50`으로 그려서 본다.
주인이 PDF만 원하면 PDF만, 고칠 수 있는 파일을 원하면 .docx도 함께 낸다.

## 표 (openpyxl)

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
ws = wb.active
ws.title = "요약"
ws.append(["항목", "값"])
for cell in ws[1]:
    cell.font = Font(bold=True)
    cell.fill = PatternFill("solid", fgColor="EEEEEE")
ws.append(["매출", 1200000])
ws["B2"].number_format = "#,##0"
ws.column_dimensions["A"].width = 24
ws.freeze_panes = "A2"
wb.save("요약.xlsx")
```

숫자는 글자가 아니라 숫자로 넣는다 (합계 · 정렬이 되게). 계산은 수식(`=SUM(B2:B10)`)으로 남겨도 된다.

## 도표 (matplotlib)

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.family"] = "Noto Sans CJK KR"
plt.rcParams["axes.unicode_minus"] = False           # 마이너스 기호가 □가 되지 않게

fig, ax = plt.subplots(figsize=(10, 5.6))           # 16:9 쪽에 넣기 좋은 비율
ax.bar(["1분기", "2분기", "3분기"], [120, 150, 90], color="#333333")
ax.set_title("분기별 매출 (억 원)")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
fig.savefig("chart.png", dpi=200)
plt.close(fig)
```

색은 짙은 회색과 강조 하나. 축 이름 · 단위를 적는다. 그린 PNG는 Read로 열어 확인한다.

## 그림 다듬기 (Pillow)

```python
from PIL import Image
img = Image.open("../inputs/사진.jpg")
img.thumbnail((1920, 1080))
img.save("사진-작게.jpg", quality=85)
```
