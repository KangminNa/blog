"""서버 브라우저의 조종 중계 (2026-11-14).

Chrome은 조종 포트(CDP)를 컨테이너 안 127.0.0.1:9222에만 연다. 컨테이너 밖의 Cairn 서버가 콘솔 화면
(그림 · 클릭 · 입력)을 위해 붙을 수 있게 9223으로 받아 그대로 넘긴다 (socat TCP-LISTEN:9223,fork TCP:127.0.0.1:9222와 같은 일).
이 컨테이너는 서버와만 붙는 망(browser)에만 있어 9223은 서버(와 같은 네트워크를 쓰는 서버 러너)만 닿는다
(docker-compose.browser.yml). 이미지에 이미 있는 python3(supervisord가 쓴다)만 써서 빌드할 때 내려받을 것이 없다.
"""

import asyncio

LISTEN = ("0.0.0.0", 9223)
CHROME = ("127.0.0.1", 9222)
CHUNK = 64 * 1024


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(CHUNK):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    try:
        chrome_reader, chrome_writer = await asyncio.open_connection(*CHROME)
    except OSError:
        client_writer.close()
        return
    await asyncio.gather(pipe(client_reader, chrome_writer), pipe(chrome_reader, client_writer))


async def main() -> None:
    server = await asyncio.start_server(handle, *LISTEN)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
