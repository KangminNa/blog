# 영상 (ffmpeg)

음성은 아직 없다. 장면(그림)마다 시간과 자막을 정해 이어 붙인다.

## 장면 그리기

슬라이드로 장면을 만들고 PNG로 그린다 (references/slides.md). 1920×1080에 맞춘다.

```bash
mkdir -p frames
soffice --headless --convert-to pdf --outdir frames 장면.pptx >/dev/null
pdftoppm -png -scale-to-x 1920 -scale-to-y 1080 frames/장면.pdf frames/s   # frames/s-01.png …
```

## 이어 붙이기

장면 목록 파일 (`scenes.txt`). 마지막 장면은 한 번 더 적어야 길이가 지켜진다:

```
file 'frames/s-01.png'
duration 5
file 'frames/s-02.png'
duration 7
file 'frames/s-02.png'
```

```bash
ffmpeg -y -f concat -safe 0 -i scenes.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 23 -movflags +faststart 영상.mp4
```

## 자막

SRT 파일을 쓰고 영상에 굽는다:

```
1
00:00:00,000 --> 00:00:05,000
첫 장면의 자막

2
00:00:05,000 --> 00:00:12,000
둘째 장면의 자막
```

```bash
ffmpeg -y -i 영상.mp4 \
  -vf "subtitles=자막.srt:force_style='FontName=Noto Sans CJK KR,FontSize=22,Outline=1'" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart 영상-자막.mp4
```

자막은 한 줄 20자 안쪽, 한 번에 두 줄까지. 장면 길이는 자막을 읽을 수 있게 (한 줄에 2초 이상).

## 움직이는 도표

matplotlib로 틀마다 PNG를 그려 이어 붙인다 (`fig.savefig(f"frames/c-{i:04d}.png", dpi=100)`):

```bash
ffmpeg -y -framerate 30 -i frames/c-%04d.png -c:v libx264 -pix_fmt yuv420p 도표.mp4
```

## 확인과 내기

- 길이 · 크기: `ffprobe -v error -show_entries format=duration,size -of default=nw=1 영상.mp4`
- 몇 장면을 그림으로 뽑아 Read로 본다: `ffmpeg -y -ss 3 -i 영상.mp4 -frames:v 1 check.png`
- 결과물은 100MB까지다. 넘으면 `-crf`를 올리거나(26~28) 해상도를 1280×720으로 낮춘다.
- 결과물 폴더에는 최종 mp4만 둔다 (자막을 구웠으면 자막판만).
