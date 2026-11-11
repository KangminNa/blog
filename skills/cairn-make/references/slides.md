# 슬라이드 (python-pptx)

## 틀

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

prs = Presentation()                      # 재료의 .pptx를 고칠 때는 Presentation("../inputs/이름.pptx")
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)   # 16:9
BLANK = prs.slide_layouts[6]              # 빈 쪽. 자리 표시가 남지 않게 빈 쪽에 상자를 직접 놓는다
FONT = "Noto Sans CJK KR"

def text(slide, left, top, width, height, lines, size=20, bold=False, color=(0x11, 0x11, 0x11)):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    frame = box.text_frame
    frame.word_wrap = True
    for i, line in enumerate(lines):
        p = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        run = p.add_run()
        run.text = line
        run.font.name = FONT              # 런마다 글꼴을 정해야 한글이 깨지지 않는다
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = RGBColor(*color)
    return box

slide = prs.slides.add_slide(BLANK)
text(slide, 0.8, 0.6, 11.7, 1.2, ["제목"], size=40, bold=True)
text(slide, 0.8, 2.0, 11.7, 4.8, ["첫 줄", "둘째 줄"], size=22)
prs.save("발표.pptx")
```

## 모양 규칙

- 쪽마다 메시지 하나. 제목은 그 쪽의 결론 문장으로 (예: "매출은 3분기에 꺾였다").
- 글자 크기: 제목 36~44pt, 본문 20pt 이상, 주석 14pt 이상. 본문은 6줄 · 줄당 30자 안쪽. 넘치면 쪽을 나눈다.
- 여백: 가장자리에서 0.6인치 이상. 상자끼리 겹치지 않게 위치를 계산해서 놓는다.
- 색은 두세 개만. 바탕은 흰색, 글자는 짙은 회색, 강조는 하나.
- 첫 쪽은 표지(제목 · 부제 · 날짜), 마지막 쪽은 요약이나 다음 할 일.
- 숫자는 재료 그대로. 출처가 재료면 쪽 아래에 작게 적는다.

## 그림 · 표 · 도표

```python
slide.shapes.add_picture("chart.png", Inches(0.8), Inches(1.8), width=Inches(7))   # 높이는 비율대로

rows, cols = 4, 3
table = slide.shapes.add_table(rows, cols, Inches(0.8), Inches(1.8), Inches(11.7), Inches(3)).table
cell = table.cell(0, 0)
cell.text = "항목"
for p in cell.text_frame.paragraphs:
    for r in p.runs:
        r.font.name, r.font.size = FONT, Pt(16)
```

도표는 matplotlib로 PNG를 그려 넣는다 (references/documents.md의 "도표"). 그림 해상도는 200dpi.

## 발표자 메모

```python
slide.notes_slide.notes_text_frame.text = "이 쪽에서 말할 것"
```

## 그려서 확인하기

```bash
mkdir -p preview
soffice --headless --convert-to pdf --outdir preview 발표.pptx >/dev/null
pdftoppm -png -r 50 preview/발표.pdf preview/p      # preview/p-01.png, p-02.png …
```

PNG를 Read로 열어 쪽마다 본다: 글자 넘침 · 겹침 · □(깨진 한글) · 빈 쪽 · 잘린 그림.
`soffice`가 멈춘 것처럼 보이면 남은 프로세스가 있는지 본다 (`pgrep soffice`). 변환은 한 번에 하나씩.

## 내기

결과물 폴더에 `.pptx`와 같은 이름의 `.pdf`를 함께 둔다 (preview 폴더의 PDF를 옮긴다).
