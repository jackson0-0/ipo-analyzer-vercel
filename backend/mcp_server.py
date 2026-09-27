from mcp.server.mcpserver import MCPServer
from app.main import get_ipos, analyze

mcp = MCPServer("ipo-analyzer")


@mcp.tool()
def list_ipos() -> list:
    """Get upcoming and priced IPOs"""
    return get_ipos()


@mcp.tool()
def analyze_ipo(company_name: str, ticker: str = "", amount: str = "", status: str = "") -> dict:
    """Analyze SEC filing excerpts; return evidence, filing source, and a score when supported."""
    return analyze(company_name, ticker, amount, status)


if __name__ == "__main__":
    mcp.run()
