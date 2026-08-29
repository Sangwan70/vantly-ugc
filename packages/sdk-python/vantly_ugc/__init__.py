# Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

"""
vantly-ugc Python SDK — AI UGC video generation.

Usage:
    from vantly_ugc import VantlyUgc

    client = VantlyUgc(api_key="ma_xxx")
    video = client.create_video(script="...", actor_slug="sofia")
    print(video["video_url"])
"""

from .client import VantlyUgc, VantlyUgcError

__all__ = ["VantlyUgc", "VantlyUgcError"]
__version__ = "0.1.0"
