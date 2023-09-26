![image](https://github.com/melvincarvalho/mindstr/assets/65864/3a656770-3c51-4ede-b59a-b09e8264f3c5)


# Mindstr
mindstr

# Status

only intended for intrepid programmers who read the sourcecode

# Mindstr Data Model Documentation

Mindstr is a web-based mind mapping tool that uses a specific data structure for representing nodes and connections. This document outlines the structure and the expected data types for each field.

## Data Structure

### 1. Version

- **Field**: `version`
- **Type**: `string`
- **Description**: Represents the version of the Mindstr data format.

### 2. Nodes

- **Field**: `nodes`
- **Type**: `array`
- **Description**: An array of individual node objects.

Each node object contains:
- **name**: `string` - The display name of the node.
- **x**: `number` - The x-coordinate position of the node on the canvas.
- **y**: `number` - The y-coordinate position of the node on the canvas.
- **bgColor** (optional): `string` - The background color of the node. If not provided, a default color is used.

### 3. Connections

- **Field**: `connections`
- **Type**: `array`
- **Description**: An array of connection objects that link nodes together.

Each connection object contains:
- **start**: `number` - The index of the starting node in the `nodes` array.
- **end**: `number` - The index of the ending node in the `nodes` array.

### 4. Selected Node

- **Field**: `selectedNode`
- **Type**: `number` or `null`
- **Description**: The index of the currently selected node in the `nodes` array. If no node is selected, the value is `null`.

## Example JSON Representation

```json
{
  "version": "0.1",
  "nodes": [
    {
      "name": "Root Node",
      "x": 500,
      "y": 50,
      "bgColor": "#FFD6E8"
    },
    {
      "name": "Child Node",
      "x": 550,
      "y": 100
    }
  ],
  "connections": [
    {
      "start": 0,
      "end": 1
    }
  ],
  "selectedNode": 1
}
```

---

This markdown provides a concise overview of the data structure used in Mindstr. For specific implementation details or further clarifications, refer to the application's source code.
