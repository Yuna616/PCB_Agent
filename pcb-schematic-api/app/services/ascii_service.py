"""
PCB Schematic API — ASCII Diagram Service
원리도 데이터를 사람이 읽을 수 있는 ASCII 블록 다이어그램으로 변환합니다.
"""
from typing import Dict, List, Set

from app.models.response import Component, Connection, Net, PowerSupply


CATEGORY_ICONS = {
    "MCU": "▣",
    "Sensor": "◈",
    "Display": "▦",
    "Regulator": "⊞",
    "Connector": "⊟",
    "Passive": "▪",
    "Other": "○",
}

BOX_WIDTH = 32   # 블록 박스 너비


class ASCIIService:

    def generate(
        self,
        project_summary: str,
        power_supply: PowerSupply,
        components: List[Component],
        connections: List[Connection],
        nets: List[Net],
    ) -> str:
        lines: List[str] = []

        lines += self._header(project_summary)
        lines += self._power_section(power_supply)
        lines += self._component_blocks(components)
        lines += self._net_table(nets)
        lines += self._wiring_section(components, connections)
        lines += self._footer()

        return "\n".join(lines)

    # ── 섹션별 생성 ──────────────────────────────

    def _header(self, summary: str) -> List[str]:
        width = 70
        border = "═" * width
        lines = [
            f"╔{border}╗",
            self._center("PCB Schematic — AI 자동 생성", width),
            self._center(summary[:width - 4], width),
            f"╚{border}╝",
            "",
        ]
        return lines

    def _power_section(self, ps: PowerSupply) -> List[str]:
        lines = ["┌─ 전원 구성 " + "─" * 57 + "┐"]
        lines.append(f"│  입력: {ps.input:<60}│")
        for rail in ps.rails:
            src = f"← {rail.source}" if rail.source else ""
            cur = f"  ({rail.current_ma}mA)" if rail.current_ma else ""
            lines.append(f"│  {rail.name:10} {rail.voltage:8}{cur:12} {src:<28}│")
        lines.append("└" + "─" * 69 + "┘")
        lines.append("")
        return lines

    def _component_blocks(self, components: List[Component]) -> List[str]:
        """카테고리별로 컴포넌트 박스를 그립니다"""
        # 카테고리별 그룹화
        from collections import defaultdict
        groups: Dict[str, List[Component]] = defaultdict(list)
        order = ["Regulator", "MCU", "Sensor", "Display", "Connector", "Passive", "Other"]
        for c in components:
            cat = c.category if c.category in order else "Other"
            groups[cat].append(c)

        lines = ["┌─ 부품 블록 " + "─" * 57 + "┐", "│" + " " * 69 + "│"]

        for cat in order:
            if cat not in groups:
                continue
            icon = CATEGORY_ICONS.get(cat, "○")
            lines.append(f"│  {icon} [{cat}]" + " " * (64 - len(cat)) + "│")

            for comp in groups[cat]:
                # 부품 박스
                top    = f"│      ┌{'─' * BOX_WIDTH}┐" + " " * (36 - BOX_WIDTH) + "│"
                title  = f"│      │ {comp.ref:<6} {comp.value:<{BOX_WIDTH - 9}} │" + " " * (36 - BOX_WIDTH) + "│"
                sub    = f"│      │ {comp.description[:BOX_WIDTH - 2]:<{BOX_WIDTH - 2}} │" + " " * (36 - BOX_WIDTH) + "│"
                pkg    = f"│      │ pkg: {comp.package:<{BOX_WIDTH - 6}} │" + " " * (36 - BOX_WIDTH) + "│"
                bot    = f"│      └{'─' * BOX_WIDTH}┘" + " " * (36 - BOX_WIDTH) + "│"

                # 주요 넷 표시 (핀 수 제한)
                shown_pins = comp.pins[:6]
                pin_lines = []
                for pin in shown_pins:
                    pin_str = f"│          {pin.pin_number:>3} {pin.pin_name:<12} → {pin.net:<16}│"
                    pin_lines.append(pin_str)
                if len(comp.pins) > 6:
                    pin_lines.append(f"│          ... (+{len(comp.pins) - 6} pins)                                  │")

                lines += [top, title, sub, pkg, bot] + pin_lines
                lines.append("│" + " " * 69 + "│")

        lines.append("└" + "─" * 69 + "┘")
        lines.append("")
        return lines

    def _net_table(self, nets: List[Net]) -> List[str]:
        power_nets = [n for n in nets if n.net_type == "power"]
        ground_nets = [n for n in nets if n.net_type == "ground"]
        signal_nets = [n for n in nets if n.net_type == "signal"]

        lines = ["┌─ 넷 목록 " + "─" * 59 + "┐"]
        lines.append(f"│  {'넷 이름':<20} {'타입':<10} {'전압':<8} {'설명':<28}│")
        lines.append("│  " + "─" * 67 + "│")

        for net in power_nets + ground_nets + signal_nets:
            v = net.voltage or ""
            d = (net.description or "")[:28]
            lines.append(f"│  {net.name:<20} {net.net_type:<10} {v:<8} {d:<28}│")

        lines.append("└" + "─" * 69 + "┘")
        lines.append("")
        return lines

    def _wiring_section(
        self, components: List[Component], connections: List[Connection]
    ) -> List[str]:
        """넷별 배선 연결을 ASCII로 표시"""
        lines = ["┌─ 배선 연결 " + "─" * 57 + "┐"]

        comp_map = {c.ref: c for c in components}

        for conn in connections:
            net = conn.net
            nodes = conn.nodes
            if not nodes:
                continue

            # 넷 헤더
            lines.append(f"│  ● {net:<65}│")

            # 트리 형태로 연결 표시
            for i, node in enumerate(nodes):
                is_last = i == len(nodes) - 1
                branch = "└──" if is_last else "├──"
                comp = comp_map.get(node.ref)
                desc = f"({comp.value})" if comp else ""
                line = f"│      {branch} {node.ref}.{node.pin} [{node.pin_name}] {desc}"
                lines.append(f"{line:<70}│")

            lines.append("│" + " " * 69 + "│")

        lines.append("└" + "─" * 69 + "┘")
        lines.append("")
        return lines

    def _footer(self) -> List[str]:
        return [
            "─" * 71,
            "  ※ EasyEDA에서 회로를 그리려면:",
            "     1) 상단 [배치] → [부품]으로 각 심볼을 배치합니다.",
            "     2) 배선은 [배치] → [배선] (단축키 W)으로 연결합니다.",
            "     3) 넷 이름이 같은 선은 [배치] → [네트 라벨] (단축키 N)으로 연결합니다.",
            "     4) 완료 후 [도구] → [ERC] (전기 규칙 검사)를 실행합니다.",
            "─" * 71,
        ]

    # ── 유틸 ─────────────────────────────────────

    def _center(self, text: str, width: int) -> str:
        pad = width - len(text)
        lpad = pad // 2
        rpad = pad - lpad
        return f"║{' ' * lpad}{text}{' ' * rpad}║"
