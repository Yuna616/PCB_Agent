/**
 * PCBAgent Circuit Template Library
 * Pre-built circuits in the strict agent JSON format.
 *
 * Exposes: window.PCBTemplates
 */
window.PCBTemplates = (() => {
  'use strict';

  // ── Template definitions ──────────────────────────────────────────────────

  const TEMPLATES = {

    /** ESP32 minimal base circuit: ESP32 + LDO 3.3V + USB-C power + decoupling caps */
    esp32_base: {
      id:          'esp32_base',
      name:        'ESP32 Base Circuit',
      description: 'ESP32-WROOM-32 with 3.3V LDO, USB-C power input, decoupling capacitors, and UART header',
      tags:        ['ESP32', 'IoT', 'WiFi', 'BLE'],
      components: [
        { id: 'J1',  type: 'USB_C',     x: 60,  y: 200, value: 'USB-C PWR',  description: 'Power input' },
        { id: 'U1',  type: 'LDO_3.3V',  x: 200, y: 200, value: 'AMS1117-3.3', description: '3.3V LDO regulator' },
        { id: 'U2',  type: 'ESP32',      x: 380, y: 200, value: 'ESP32-WROOM', description: 'Main MCU' },
        { id: 'C1',  type: 'CAPACITOR',  x: 200, y: 280, value: '10uF',        description: 'LDO input bulk cap' },
        { id: 'C2',  type: 'CAPACITOR',  x: 260, y: 280, value: '100nF',       description: 'LDO input bypass cap' },
        { id: 'C3',  type: 'CAPACITOR',  x: 380, y: 320, value: '10uF',        description: 'ESP32 VCC bulk cap' },
        { id: 'C4',  type: 'CAPACITOR',  x: 440, y: 320, value: '100nF',       description: 'ESP32 VCC bypass cap' },
        { id: 'R1',  type: 'RESISTOR',   x: 500, y: 200, value: '10k',         description: 'EN pull-up' },
        { id: 'J2',  type: 'CONN_4P',    x: 560, y: 200, value: 'UART',        description: 'UART debug header' },
      ],
      connections: [
        { from: 'J1.VBUS',   to: 'U1.IN',       net: 'USB_5V'  },
        { from: 'J1.GND',    to: 'PWR.GND',      net: 'GND'     },
        { from: 'U1.OUT',    to: 'U2.VCC',       net: '3V3'     },
        { from: 'U1.OUT',    to: 'C3.P',         net: '3V3'     },
        { from: 'U1.OUT',    to: 'C4.P',         net: '3V3'     },
        { from: 'U1.IN',     to: 'C1.P',         net: 'USB_5V'  },
        { from: 'U1.IN',     to: 'C2.P',         net: 'USB_5V'  },
        { from: 'U1.GND',    to: 'PWR.GND',      net: 'GND'     },
        { from: 'U2.GND',    to: 'PWR.GND',      net: 'GND'     },
        { from: 'U2.EN',     to: 'R1.1',         net: 'ESP_EN'  },
        { from: 'R1.2',      to: 'PWR.3V3',      net: '3V3'     },
        { from: 'U2.TX',     to: 'J2.1',         net: 'UART_TX' },
        { from: 'U2.RX',     to: 'J2.2',         net: 'UART_RX' },
        { from: 'J2.3',      to: 'PWR.3V3',      net: '3V3'     },
        { from: 'J2.4',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'C1.N',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'C2.N',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'C3.N',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'C4.N',      to: 'PWR.GND',      net: 'GND'     },
      ],
    },

    /** CAN Bus interface: TJA1051T CAN transceiver with ESP32 + OBD connector */
    can_interface: {
      id:          'can_interface',
      name:        'CAN Bus Interface',
      description: 'TJA1051T CAN transceiver with termination resistor, split termination cap, and ESD protection',
      tags:        ['CAN', 'Automotive', 'OBD2', 'Industrial'],
      components: [
        { id: 'U3',  type: 'CAN_TRANS',  x: 300, y: 200, value: 'TJA1051T',   description: 'CAN transceiver' },
        { id: 'R2',  type: 'RESISTOR',   x: 420, y: 160, value: '60R',         description: 'CAN bus termination' },
        { id: 'C5',  type: 'CAPACITOR',  x: 420, y: 240, value: '4.7nF',       description: 'Split termination cap' },
        { id: 'D1',  type: 'TVS',        x: 500, y: 160, value: 'SMAJ12A',     description: 'CAN H ESD protection' },
        { id: 'D2',  type: 'TVS',        x: 500, y: 240, value: 'SMAJ12A',     description: 'CAN L ESD protection' },
        { id: 'J3',  type: 'CONN_4P',    x: 600, y: 200, value: 'CAN_CONN',    description: 'CAN bus connector (CANH/CANL/GND/SHIELD)' },
        { id: 'C6',  type: 'CAPACITOR',  x: 300, y: 320, value: '100nF',       description: 'TJA1051 VCC bypass' },
      ],
      connections: [
        { from: 'U3.VCC',    to: 'PWR.3V3',      net: '3V3'     },
        { from: 'U3.GND',    to: 'PWR.GND',      net: 'GND'     },
        { from: 'U3.TXD',    to: 'U2.CAN_TX',    net: 'CAN_TX'  },
        { from: 'U3.RXD',    to: 'U2.CAN_RX',    net: 'CAN_RX'  },
        { from: 'U3.CANH',   to: 'R2.1',         net: 'CANH'    },
        { from: 'U3.CANL',   to: 'R2.2',         net: 'CANL'    },
        { from: 'R2.2',      to: 'C5.P',         net: 'CANL'    },
        { from: 'C5.N',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'U3.CANH',   to: 'D1.A',         net: 'CANH'    },
        { from: 'D1.K',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'U3.CANL',   to: 'D2.A',         net: 'CANL'    },
        { from: 'D2.K',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'U3.CANH',   to: 'J3.1',         net: 'CANH'    },
        { from: 'U3.CANL',   to: 'J3.2',         net: 'CANL'    },
        { from: 'J3.3',      to: 'PWR.GND',      net: 'GND'     },
        { from: 'C6.P',      to: 'PWR.3V3',      net: '3V3'     },
        { from: 'C6.N',      to: 'PWR.GND',      net: 'GND'     },
      ],
    },

    /** OBD2 power module: 12V car battery → 5V buck → 3.3V LDO, with reverse-polarity protection */
    obd_power: {
      id:          'obd_power',
      name:        'OBD2 Power Module',
      description: '12V OBD2 vehicle power → 5V/2A Buck converter → 3.3V LDO, with reverse-polarity and ESD protection',
      tags:        ['OBD2', 'Automotive', '12V', 'Power'],
      components: [
        { id: 'J4',  type: 'CONN_2P',    x: 60,  y: 200, value: 'OBD_PWR',    description: 'OBD2 power pins (12V/GND)' },
        { id: 'D3',  type: 'DIODE_SCH',  x: 140, y: 200, value: 'SS34',        description: 'Reverse polarity protection' },
        { id: 'F1',  type: 'FERRITE',    x: 140, y: 160, value: '600R@100MHz', description: 'EMI filter on 12V input' },
        { id: 'C7',  type: 'CAPACITOR',  x: 200, y: 160, value: '47uF',        description: '12V input bulk capacitor' },
        { id: 'C8',  type: 'CAPACITOR',  x: 260, y: 160, value: '100nF',       description: '12V input bypass capacitor' },
        { id: 'U4',  type: 'BUCK_5V',    x: 340, y: 200, value: 'MP2315',      description: '5V/2A synchronous buck' },
        { id: 'L1',  type: 'INDUCTOR',   x: 420, y: 180, value: '4.7uH',       description: 'Buck output inductor' },
        { id: 'C9',  type: 'CAPACITOR',  x: 480, y: 160, value: '47uF',        description: '5V output bulk capacitor' },
        { id: 'C10', type: 'CAPACITOR',  x: 540, y: 160, value: '100nF',       description: '5V output bypass capacitor' },
        { id: 'U5',  type: 'LDO_3.3V',   x: 620, y: 200, value: 'AMS1117-3.3', description: '3.3V LDO from 5V rail' },
        { id: 'C11', type: 'CAPACITOR',  x: 700, y: 160, value: '10uF',        description: '3.3V output bulk capacitor' },
        { id: 'C12', type: 'CAPACITOR',  x: 760, y: 160, value: '100nF',       description: '3.3V output bypass capacitor' },
        { id: 'R3',  type: 'RESISTOR',   x: 340, y: 300, value: '100k',        description: 'Buck feedback divider high' },
        { id: 'R4',  type: 'RESISTOR',   x: 400, y: 300, value: '20k',         description: 'Buck feedback divider low' },
      ],
      connections: [
        { from: 'J4.1',   to: 'D3.A',      net: 'VIN_12V_RAW'  },
        { from: 'J4.2',   to: 'PWR.GND',   net: 'GND'          },
        { from: 'D3.K',   to: 'F1.1',      net: 'VIN_12V'      },
        { from: 'F1.2',   to: 'C7.P',      net: 'VIN_12V_FILT' },
        { from: 'F1.2',   to: 'C8.P',      net: 'VIN_12V_FILT' },
        { from: 'F1.2',   to: 'U4.IN',     net: 'VIN_12V_FILT' },
        { from: 'C7.N',   to: 'PWR.GND',   net: 'GND'          },
        { from: 'C8.N',   to: 'PWR.GND',   net: 'GND'          },
        { from: 'U4.OUT', to: 'L1.1',      net: 'SW_NODE'       },
        { from: 'L1.2',   to: 'C9.P',      net: '5V'           },
        { from: 'L1.2',   to: 'C10.P',     net: '5V'           },
        { from: 'L1.2',   to: 'U5.IN',     net: '5V'           },
        { from: 'L1.2',   to: 'R3.1',      net: '5V'           },
        { from: 'R3.2',   to: 'U4.FB',     net: 'FB_5V'        },
        { from: 'R4.1',   to: 'U4.FB',     net: 'FB_5V'        },
        { from: 'R4.2',   to: 'PWR.GND',   net: 'GND'          },
        { from: 'C9.N',   to: 'PWR.GND',   net: 'GND'          },
        { from: 'C10.N',  to: 'PWR.GND',   net: 'GND'          },
        { from: 'U4.GND', to: 'PWR.GND',   net: 'GND'          },
        { from: 'U5.OUT', to: 'C11.P',     net: '3V3'          },
        { from: 'U5.OUT', to: 'C12.P',     net: '3V3'          },
        { from: 'U5.GND', to: 'PWR.GND',   net: 'GND'          },
        { from: 'C11.N',  to: 'PWR.GND',   net: 'GND'          },
        { from: 'C12.N',  to: 'PWR.GND',   net: 'GND'          },
      ],
    },

    /** Complete OBD2 dongle: OBD power + ESP32 + CAN (combined full circuit) */
    obd_full: {
      id:          'obd_full',
      name:        'OBD2 Full Dongle (ESP32 + CAN)',
      description: 'Complete OBD2 dongle: 12V power → 5V/3.3V + ESP32 + CAN transceiver + UART debug',
      tags:        ['OBD2', 'CAN', 'ESP32', 'Automotive', 'Complete'],
      components: [], // dynamically merged from esp32_base + can_interface + obd_power
      connections: [],
    },

  };

  // Build the combined OBD full circuit by merging the three sub-templates
  (() => {
    const base = TEMPLATES.esp32_base;
    const can  = TEMPLATES.can_interface;
    const pwr  = TEMPLATES.obd_power;

    // Merge components, offset positions to avoid overlap
    const offsetCan = (comp) => ({ ...comp, x: comp.x + 700, y: comp.y });
    const offsetPwr = (comp) => ({ ...comp, x: comp.x, y: comp.y + 450 });

    TEMPLATES.obd_full.components = [
      ...base.components,
      ...can.components.map(offsetCan),
      ...pwr.components.map(offsetPwr),
    ];

    TEMPLATES.obd_full.connections = [
      ...base.connections,
      ...can.connections,
      ...pwr.connections,
      // Cross-template connections
      { from: 'U5.OUT',  to: 'U1.IN',   net: '5V' },    // OBD 5V → ESP32 LDO input
    ];
  })();

  // ── Public API ────────────────────────────────────────────────────────────

  function getAll() {
    return Object.values(TEMPLATES).map(t => ({
      id:          t.id,
      name:        t.name,
      description: t.description,
      tags:        t.tags,
    }));
  }

  function get(id) {
    const t = TEMPLATES[id];
    if (!t) return null;
    // Deep clone to prevent mutation of the template
    return JSON.parse(JSON.stringify(t));
  }

  function search(query) {
    const q = query.toLowerCase();
    return Object.values(TEMPLATES).filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    ).map(t => ({
      id:          t.id,
      name:        t.name,
      description: t.description,
      tags:        t.tags,
    }));
  }

  return Object.freeze({ getAll, get, search });
})();
