# Monolis agent workspace

You are operating on Monolis, a garment-industry ERP/SCM, through MCP tools
(`mcp__monolis__*`) that call the backend's REST API as a test user. Read tools
(`get_*`) are auto-approved; the two write tools require explicit user approval.

## Domain glossary (draft — refine during rehearsal)

- **Sales order (SO):** an order from a buyer/brand covering one or more styles for a season. Tools: `get_sales_order*`.
- **Style:** a garment design; has colorways, size breakdowns, and a BOM. Tools: `get_style*`, `get_style_plan*`.
- **BOM (bill of materials):** materials a style needs — fabrics (`get_bom_fabric*`) and accessories/trims (`get_bom_accessory*`); `get_bom_all*` aggregates both.
- **Consumption:** computed required quantity of a material for an order. Fabrics: `get_fabric_consumption*`; accessories: `get_acc_consumption*`.
- **PO-consumption** (`get_fabric_poconsumption*`, `get_acc_poconsumption*`): links consumption records to purchase orders — i.e. how much of a material requirement is already covered by existing POs. The gap between consumption and PO-consumption is the shortage.
- **Purchase order (PO):** an order to a supplier (type FABRIC / ACCESSORY / OUTSOURCING / PRE_OUTSOURCING). Created FROM consumption records by passing their `consumptionIds`. Read: `get_purchase_order*`. Create: `create_purchase_order` (write — needs approval).
- **sopo:** sales-order ↔ purchase-order linkage (`get_sopo*`).
- **Assortment:** size/color quantity distribution for an SO (`get_assort*`, `get_so_assortment*`).
- **Costing breakdown:** per-style cost calculation; versioned (`get_costing_breakdown*`).
- **Shipment plan:** planned shipments fulfilling an SO (`get_shipment_plan*`).

### Beyond sales order (full cross-domain coverage)

- **Production:** per-process tracking — `get_production_cutting*`, `get_production_sewing*`, `get_production_qc*`, `get_production_packing*`, `get_production_finishing*`, `get_production_input*`, `get_production_report*`, `get_today_output*`. Line assignment: `get_assign_line*` (move/rebalance styles across lines), `get_line*`, `get_production_calendar*`.
- **Order tracking:** live status of an order across its lifecycle — `get_order_tracking*`.
- **Logistics / shipping:** `get_shipment*`, `get_logistics*`, `get_product_loading*` (container loading), `get_courier*`, `get_port*`, `get_ship_mode*`, `get_production_shipment*`, `get_garment_invoice*`.
- **Materials / inventory:** `get_warehouse*`, `get_fabric_library*`, `get_accessory_library*`, `get_supplier*`, `get_material_checklist*`.
- **Costing & finance:** `get_costing_breakdown*`, `get_finance_accounts_receivable*` (미수금 / AR), `get_payment*`, `get_settlements*`, `get_settlement_notes*`, `get_purchase_order_payment*`.
- **Dashboards & KPIs (prefer these for aggregate/analytics questions):** `get_dashboard_monthly_performance`, `get_dashboard_order_fulfillment`, `get_dashboard_profitability_analysis`, `get_dashboard_order_records`, `get_dashboard_material_records`, `get_dashboard_production_records`, `get_target_performance*` (target vs actual). When a question asks for a roll-up, a trend, a KPI, or "this month's total", check for a dashboard/finance/target-performance endpoint *before* pulling raw records and summing them yourself.
- **Out of scope (no data in Monolis):** customer satisfaction / star ratings, competitor comparison, and any forecast/prediction (delay risk, demand, target-attainment probability) — those are handled separately by the data-science team, not by these tools. Say so plainly rather than fabricating numbers.

## How to work

- Explore with `get_*` tools — the same REST API the web app uses. Prefer
  filtered queries (pass IDs/status); responses over 40k chars are truncated
  with a hint to narrow the filter.
- Tool names are snake_case derived from the API routes; the description on each
  tool is authoritative for what it does. When unsure which tool fits, read the
  descriptions rather than guessing from the name.
- Mutations (`create_purchase_order`, `create_comment`) require user approval.
  Before calling them, state clearly what you intend to create and why.
- Shortage → draft-PO workflow: SO → its styles → each style's BOM →
  consumption (required) vs PO-consumption (already covered) → the shortfall →
  group shortfalls by supplier and material type → one draft PO per group.
- If a tool fails with 403, the test account lacks permission for that endpoint —
  report it rather than retrying.
