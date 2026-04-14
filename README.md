# topo_babel

A tool to convert cave survey files from one format to another. It is built on top of the `babel` library, which provides a common interface for reading and writing cave survey files in various formats.

## Supported formats:
- Currently, topo_babel supports the following formats:
    + vtopo files -> CaveRender project XML files
    + vtopo files -> CaveRender survey data TXT files
    + survex files (.svx, survey data only) -> CaveRender project XML files
    + survex files (.svx, survey data only) -> CaveRender survey data TXT files

## Usage:
Topo babel can be used with the web interface. Load a `.tro` or `.svx` file, review the detected cave metadata, choose the export format, and download either a CaveRender project XML or survey-data TXT file.
