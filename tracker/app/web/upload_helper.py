"""HomeBase: map uploads are turned off.

Upstream uploads the closest/farthest maps (which show the home area) to the
tracker author's personal server to make a shareable link for email alerts.
HomeBase keeps the maps on this server and shows them itself, so nothing is
uploaded and these return an empty link.
"""


def get_upload_token() -> str:
    return ""


def upload_map_to_server(local_path: str) -> str:
    return ""
