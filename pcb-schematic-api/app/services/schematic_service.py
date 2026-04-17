"""
PCB Schematic API — Schematic Service
AI 출력(dict) → 각 응답 모델 변환 + EasyEDA JSON 생성
"""
from typing import Any, Dict, List, Optional

from app.models.response import (
    BOMItem,
    Component,
    Connection,
    ConnectionNode,
    DesignStage,
    EasyEDAComponent,
    EasyEDANetLabel,
    EasyEDAPin,
    EasyEDASchematic,
    EasyEDAWire,
    Net,
    PinConnection,
    PowerRail,
    PowerSupply,
    SchematicData,
)


# ─────────────────────────────────────────────
# 레이아웃 상수 (EasyEDA 좌표계 기준)
# ─────────────────────────────────────────────

GRID = 100          # 기본 그리드 단위
COL_WIDTH = 600     # 컴포넌트 열 간격
ROW_HEIGHT = 500    # 컴포넌트 행 간격
ORIGIN_X = 200
ORIGIN_Y = 200

CATEGORY_ORDER = ["Regulator", "MCU", "Sensor", "Display", "Connector", "Passive", "Other"]


class SchematicService:
    """AI 출력 dict를 응답 모델로 변환하고 EasyEDA JSON을 생성합니다."""

    # ── 메인 변환 ────────────────────────────────

    def parse_schematic_data(self, data: Dict[str, Any]) -> SchematicData:
        """AI JSON → SchematicData"""
        return SchematicData(
            project_summary=data.get("project_summary", ""),
            design_stages=self._parse_stages(data.get("design_stages", [])),
            power_supply=self._parse_power(data.get("power_supply", {})),
            components=self._parse_components(data.get("components", [])),
            nets=self._parse_nets(data.get("nets", [])),
            connections=self._parse_connections(data.get("connections", [])),
            erc_notes=data.get("erc_notes", []),
        )

    def build_bom(self, components: List[Component]) -> List[BOMItem]:
        """부품 목록 → BOM"""
        bom: List[BOMItem] = []
        for c in components:
            bom.append(
                BOMItem(
                    ref=c.ref,
                    value=c.value,
                    description=c.description,
                    package=c.package,
                    quantity=c.quantity,
                    category=c.category,
                    search_keyword=c.search_keyword,
                    notes=c.datasheet_url,
                )
            )
        return sorted(bom, key=lambda b: (CATEGORY_ORDER.index(b.category)
                                          if b.category in CATEGORY_ORDER else 99, b.ref))

    def build_easyeda_json(
        self,
        title: str,
        components: List[Component],
        connections: List[Connection],
    ) -> EasyEDASchematic:
        """
        컴포넌트 + 연결 정보 → EasyEDA 호환 JSON
        - 카테고리별 그리드 배치
        - 넷 라벨로 배선 표현 (복잡한 wire 대신 넷 라벨 방식)
        - raw_shapes 에 EasyEDA shape 문자열 생성
        """
        placed = self._auto_place(components)
        net_labels = self._build_net_labels(placed, components)
        power_symbols = self._build_power_symbols(components)
        wires = self._build_stub_wires(placed)
        raw_shapes = self._build_raw_shapes(placed, components, net_labels, power_symbols)

        return EasyEDASchematic(
            title=title,
            description=f"AI 자동 생성 원리도 — {title}",
            components=[p["easyeda"] for p in placed.values()],
            wires=wires,
            net_labels=net_labels,
            power_symbols=power_symbols,
            raw_shapes=raw_shapes,
        )

    # ── 파싱 헬퍼 ───────────────────────────────

    def _parse_stages(self, raw: List[Dict]) -> List[DesignStage]:
        result = []
        for i, s in enumerate(raw, 1):
            result.append(DesignStage(
                stage=s.get("stage", i),
                name=s.get("name", f"Stage {i}"),
                description=s.get("description", ""),
                tasks=s.get("tasks", []),
                completion_criteria=s.get("completion_criteria", ""),
            ))
        return result

    def _parse_power(self, raw: Dict) -> PowerSupply:
        rails = []
        for r in raw.get("rails", []):
            rails.append(PowerRail(
                name=r.get("name", ""),
                voltage=r.get("voltage", ""),
                current_ma=r.get("current_ma"),
                source=r.get("source"),
            ))
        return PowerSupply(input=raw.get("input", ""), rails=rails)

    def _parse_components(self, raw: List[Dict]) -> List[Component]:
        result = []
        for c in raw:
            pins = [
                PinConnection(
                    pin_number=p.get("pin_number", ""),
                    pin_name=p.get("pin_name", ""),
                    net=p.get("net", ""),
                    direction=p.get("direction"),
                )
                for p in c.get("pins", [])
            ]
            result.append(Component(
                ref=c.get("ref", ""),
                value=c.get("value", ""),
                description=c.get("description", ""),
                package=c.get("package", ""),
                category=c.get("category", "Other"),
                quantity=c.get("quantity", 1),
                search_keyword=c.get("search_keyword", ""),
                datasheet_url=c.get("datasheet_url"),
                pins=pins,
            ))
        return result

    def _parse_nets(self, raw: List[Dict]) -> List[Net]:
        return [
            Net(
                name=n.get("name", ""),
                net_type=n.get("net_type", "signal"),
                voltage=n.get("voltage"),
                description=n.get("description"),
            )
            for n in raw
        ]

    def _parse_connections(self, raw: List[Dict]) -> List[Connection]:
        result = []
        for c in raw:
            nodes = [
                ConnectionNode(
                    ref=n.get("ref", ""),
                    pin=n.get("pin", ""),
                    pin_name=n.get("pin_name", ""),
                )
                for n in c.get("nodes", [])
            ]
            result.append(Connection(net=c.get("net", ""), nodes=nodes))
        return result

    # ── EasyEDA 레이아웃 ─────────────────────────

    def _auto_place(self, components: List[Component]) -> Dict[str, Dict]:
        """카테고리별로 컴포넌트를 그리드에 배치"""
        # 카테고리별 그룹화
        groups: Dict[str, List[Component]] = {}
        for c in components:
            cat = c.category if c.category in CATEGORY_ORDER else "Other"
            groups.setdefault(cat, []).append(c)

        placed: Dict[str, Dict] = {}
        col = 0
        for cat in CATEGORY_ORDER:
            if cat not in groups:
                continue
            for row, comp in enumerate(groups[cat]):
                x = ORIGIN_X + col * COL_WIDTH
                y = ORIGIN_Y + row * ROW_HEIGHT

                # EasyEDA 컴포넌트 핀 좌표 계산
                easyeda_pins = []
                for i, pin in enumerate(comp.pins):
                    px = x + (i % 2) * GRID * 3
                    py = y + (i // 2) * GRID
                    easyeda_pins.append(EasyEDAPin(
                        pin_number=pin.pin_number,
                        pin_name=pin.pin_name,
                        net=pin.net,
                        x=px,
                        y=py,
                    ))

                placed[comp.ref] = {
                    "component": comp,
                    "x": x,
                    "y": y,
                    "easyeda": EasyEDAComponent(
                        ref=comp.ref,
                        value=comp.value,
                        package=comp.package,
                        x=x,
                        y=y,
                        rotation=0,
                        pins=easyeda_pins,
                    ),
                }
            col += 1
        return placed

    def _build_net_labels(
        self, placed: Dict[str, Dict], components: List[Component]
    ) -> List[EasyEDANetLabel]:
        """각 신호 핀 옆에 넷 라벨 배치"""
        labels: List[EasyEDANetLabel] = []
        seen = set()
        for comp in components:
            if comp.ref not in placed:
                continue
            base_x = placed[comp.ref]["x"]
            base_y = placed[comp.ref]["y"]
            for i, pin in enumerate(comp.pins):
                if pin.net in ("GND", "VCC", "3V3", "5V", "VBUS", "3.3V") :
                    continue  # 파워 심볼로 처리
                label_key = f"{comp.ref}_{pin.pin_number}"
                if label_key in seen:
                    continue
                seen.add(label_key)
                lx = base_x + GRID * 4 + (i % 2) * GRID * 2
                ly = base_y + (i // 2) * GRID
                labels.append(EasyEDANetLabel(name=pin.net, x=lx, y=ly))
        return labels

    def _build_power_symbols(self, components: List[Component]) -> List[EasyEDANetLabel]:
        """GND / VCC / 3V3 파워 심볼 배치"""
        power_nets = set()
        for comp in components:
            for pin in comp.pins:
                n = pin.net.upper()
                if any(kw in n for kw in ("GND", "VCC", "3V3", "5V", "VBUS", "3.3V")):
                    power_nets.add(pin.net)

        symbols = []
        for idx, net in enumerate(sorted(power_nets)):
            symbols.append(EasyEDANetLabel(
                name=net,
                x=ORIGIN_X + idx * (GRID * 3),
                y=ORIGIN_Y - GRID * 3,
            ))
        return symbols

    def _build_stub_wires(self, placed: Dict[str, Dict]) -> List[EasyEDAWire]:
        """각 컴포넌트 핀에서 짧은 스텁 와이어 생성"""
        wires = []
        for info in placed.values():
            comp: Component = info["component"]
            bx, by = info["x"], info["y"]
            for i, pin in enumerate(comp.pins):
                px = bx + (i % 2) * GRID * 3
                py = by + (i // 2) * GRID
                wires.append(EasyEDAWire(
                    net=pin.net,
                    points=[[px, py], [px + GRID, py]],
                ))
        return wires

    def _build_raw_shapes(
        self,
        placed: Dict[str, Dict],
        components: List[Component],
        net_labels: List[EasyEDANetLabel],
        power_symbols: List[EasyEDANetLabel],
    ) -> List[str]:
        """
        EasyEDA shape 문자열 생성
        형식: https://docs.easyeda.com/en/DocumentFormat/
        LIB~x~y~attributes~...
        N~x~y~0~NetName~ggeID~
        """
        shapes = []
        gge_id = 1

        # 컴포넌트 심볼 (LIB)
        for ref, info in placed.items():
            comp: Component = info["component"]
            x, y = info["x"], info["y"]
            # 간소화된 LIB 문자열 (실제 라이브러리 심볼 대신 플레이스홀더)
            attrs = f"package`{comp.package}`value`{comp.value}`spicePre``"
            shapes.append(
                f"LIB~{x}~{y}~{attrs}~gge{gge_id}~0~{comp.search_keyword}~0~~0~0~"
            )
            gge_id += 1

        # 넷 라벨 (N)
        for lbl in net_labels:
            shapes.append(f"N~{lbl.x}~{lbl.y}~{lbl.rotation}~{lbl.name}~gge{gge_id}~")
            gge_id += 1

        # 파워 심볼 (P)
        for sym in power_symbols:
            ptype = "GND" if "GND" in sym.name.upper() else "VCC"
            shapes.append(f"P~{ptype}~{sym.x}~{sym.y}~1~gge{gge_id}~0~{sym.name}~")
            gge_id += 1

        return shapes
