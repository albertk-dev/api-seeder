# @api-seeder/mcp

**Official Model Context Protocol (MCP) Server for API Seeder**

Empowers AI assistants (Claude Desktop, Cursor, Antigravity, Zed, and custom agents) to inspect datasets, validate API seeding configurations, generate Excel templates, and autonomously execute seeding pipelines.

---

## Installation & Setup

### Claude Desktop Configuration (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "api-seeder": {
      "command": "npx",
      "args": ["-y", "@api-seeder/mcp"]
    }
  }
}
```

### Cursor / Antigravity IDE Configuration

Add an MCP server command:
* **Command**: `npx -y @api-seeder/mcp`
* **Transport**: `stdio`

---

## Exposed Tools

1. **`inspect_data_file`**:
   * Analyzes any `.xlsx`, `.xls` or `.csv` file.
   * Returns column headers, total row counts, and sample data.
2. **`validate_seeder_config`**:
   * Validates target `config.json` against canonical Zod schema.
   * Reports syntax and structure errors.
3. **`generate_excel_templates`**:
   * Generates styled empty Excel workbooks with columns inferred from configuration steps.
4. **`run_seed_job`**:
   * Executes seeding process autonomously with support for `--dry-run` and `--fail-fast`.

---

## License

MIT © [Albert Kameni](https://github.com/albertk-dev)
