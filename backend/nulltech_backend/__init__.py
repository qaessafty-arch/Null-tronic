"""NULL-TECH CIRCUIT STUDIO local service.

Pipeline: webcam -> latest-frame capture -> hand landmarks -> gesture recognition ->
smoothing -> command controller -> local WebSocket -> application input system.

The service never reads or writes engineering data; it only emits input commands
defined in shared/commands/input-commands.schema.json.
"""

__version__ = "0.1.0"
