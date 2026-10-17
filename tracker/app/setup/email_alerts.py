import smtplib
import socket
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime
from config import EMAIL, DISTANCE_UNITS, CLOCK_FORMAT
from typing import Optional
import os

def get_timestamp():
    if CLOCK_FORMAT == "24hr":
        return datetime.now().strftime("%b %d %Y, %H:%M:%S")
    return datetime.now().strftime("%b %d %Y, %I:%M:%S %p")

def format_dist(v):
    if DISTANCE_UNITS.lower() == "metric":
        return f"{v:.5f} km"
    return f"{v:.5f} miles"

def _send(subject: str, body: str, attachment_path: Optional[str] = None):
    """HomeBase: email alerts are turned off.

    Upstream sends these from the tracker author's shared Gmail account with a
    password written into the code; HomeBase removes that account and sends
    nothing. Closest/farthest records still appear in HomeBase.
    """
    return

def send_flight_summary(subject: str, entry: dict, reason: Optional[str] = None, map_url: Optional[str] = None):
    hostname = socket.gethostname()
    body = (
        f"Timestamp: {entry.get('timestamp')}\n"
        f"Hostname: {hostname}\n"
        f"Airline: {entry.get('airline','N/A')}\n"
        f"Flight: {entry.get('callsign','N/A')}\n"
        f"From: {entry.get('origin','?')}\n"
        f"To: {entry.get('destination','?')}\n"
        f"Plane: {entry.get('plane','N/A')}\n"
    )

    if reason:
        body += f"Reason: {reason}\n"

    if "distance_origin" in entry:
        body += f"Distance_origin: {format_dist(entry['distance_origin'])}\n"
    if "distance_destination" in entry:
        body += f"Distance_destination: {format_dist(entry['distance_destination'])}\n"
    if "distance" in entry:
        body += f"Distance: {format_dist(entry['distance'])}\n"

    body += f"Direction: {entry.get('direction','N/A')}\n"

    if map_url:
        body += f"\nMap URL: {map_url}\n"

    _send(subject, body)
