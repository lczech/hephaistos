from importlib.metadata import metadata, version

__version__ = version("hephaistos")
__description__ = metadata("hephaistos")["Summary"]
