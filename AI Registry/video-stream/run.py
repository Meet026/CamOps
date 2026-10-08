"""
Windows-compatible entry point for the video-stream service.

Use this instead of calling uvicorn directly on Windows:
    python run.py

Root cause of the Windows NotImplementedError:
  uvicorn's asyncio_loop_factory returns SelectorEventLoop when
  use_subprocess=True (which --reload sets), but Windows needs
  ProactorEventLoop for asyncio.create_subprocess_exec to work.
  We patch the factory above AND pass loop="asyncio" here so
  uvicorn uses our fixed factory on every worker it spawns.
"""
import sys

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "src.api:app",
        host="127.0.0.1",
        port=8100,
        reload=True,
        loop="asyncio",
    )
