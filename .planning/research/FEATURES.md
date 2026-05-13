# Feature Landscape: Dara Clean CRM

**Domain:** Outbound repeat-sales CRM for carpet/curtain/furniture cleaning, Almaty SMB
**Researched:** 2026-05-14
**Confidence:** HIGH for table stakes / MEDIUM for differentiators

---

## Table Stakes

Features users expect. Missing = product feels broken or managers won't use it.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Client database with full history | Every CRM category requires this. Managers need address, phone, order history per client. | Low | Already have 21K records in Excel; import is the real work. |
| Phone-based deduplication on import | Multiple records per client phone = call conflicts, wrong history. Industry standard. | Medium | Normalize phone format first (strip spaces, +7 vs 8 prefix for KZ). |
| Call queue: "who to call today" | Core of outbound repeat-sales flow. Managers need pre-sorted list by days-since-last-order. | Medium | Simple SQL: WHERE last_order_date < NOW() - interval '90 days' ORDER BY last_order_date ASC |
| Call disposition buttons | Reached / Not reached / Call back later. Without this managers use sticky notes. | Low | Each outcome sets next_call_date and updates client status. |
| Order creation from CRM | After a successful call, manager books order in 2 clicks without switching apps. | Medium | 4 service types (carpets/curtains/furniture/cleaning), auto-apply discount rules. |
| Client contact card | Name, phone, address, order history timeline, notes field per client. | Low | Read-only for most fields; notes editable by any manager. |
| Multi-manager access without overlap | 3-5 managers can't call the same client simultaneously. Needs assignment/lock. | Medium | "Locked to manager X" status while in active call flow; released after disposition. |
| WhatsApp message generation | KZ market communicates via WhatsApp. Generating follow-up text + wa.me link is minimum viable. | Low | OpenRouter call -> text -> clickable wa.me/{phone}?text={encoded_message} link. |
| Role-based access | Managers see their queue; owner sees everything + analytics. | Low | Supabase RLS: manager role vs admin role. |
| Basic analytics for owner | How many calls today, conversion rate, orders created. Without this owner is flying blind. | Medium | Aggregate queries on calls table. |

---

## Differentiators

Features that separate Dara Clean CRM from a generic spreadsheet + WhatsApp workflow.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| RFM-based client segmentation | Classifies clients as New / Repeat / Loyal / At Risk / Lost based on recency + frequency + spend. Managers prioritize differently by segment. | Medium | Computed column or materialized view. Recency = days since last order. Frequency = order count. Monetary = total spend. 3-tier labeling is enough. |
| AI-generated WhatsApp messages | Personalized per client (name, service type, last order date) vs templated mass text. Higher open/response rates. | Low | Single OpenRouter call with client context. ~$0.001/message. Worth it for personalization. |
| Discount grid with auto-apply | 5% base / 10% over 30K / 15% complex order — shown automatically when creating order. Removes manager guesswork. | Low | Config table in DB. At order creation: compute discount tier, show adjusted price before confirming. |
| Financial impact calculator for discounts | Owner sees: "if we give 10% discount to 200 clients this month, margin drops by X tenge." Prevents over-discounting given cash gap. | Medium | Static model: (orders × avg_check × discount_rate) × margin_contribution_rate. Input sliders, output KPI deltas. |
| Manager KPI dashboard | Each manager sees their own: calls made, conversion %, orders created, revenue generated. Motivates without micromanagement. | Medium | Per-manager aggregation. Key metrics: calls today, calls this week, orders won, revenue won. |
| Bonus calculator (sverkh-plan) | "Company earns above plan first, then shares" model. Shows manager their projected bonus based on current progress vs monthly plan. | High | Requires plan targets per manager per month. Complex formula: base + % of personal sverkh-plan. Build after core flow proven. |
| Call-back scheduling | Manager sets "call again in 3 days" and client reappears in their queue on that date. | Low | next_call_date field + queue filter. Simple but high value for not losing warm leads. |
| Segment-targeted campaigns | Owner can select a segment (e.g. "At Risk, last order 90-180 days") and push all clients into managers' queues for that week. | Medium | Bulk INSERT into call_queue with assignment to managers. Round-robin or manual split. |
| Repeat rate metric | Shows % of clients who returned within 6 months. The core business goal metric — visible on dashboard. | Low | Simple ratio query. Baseline, weekly trend, target line (30-40%). |

---

## Anti-Features

Things to explicitly NOT build in this CRM, given scope, constraints, and timeline.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automatic WhatsApp sending (via API/bot) | Business WhatsApp API requires Meta approval, costs setup time. Out of scope per PROJECT.md. | Generate message + wa.me deep link. Manager clicks, WhatsApp opens pre-filled. One click send. |
| Full scheduling/dispatch system | Scheduler is a separate product (HouseCall Pro, Jobber). Not the CRM's job. | Create order record with service type. Dispatch handled in Agbis or manually. |
| GPS courier tracking | No infrastructure. Explicitly out of scope per PROJECT.md. | Not in this milestone. |
| Two-way WhatsApp inbox | Requires WhatsApp Business API, webhook handling, conversation threading. Massive scope. | One-way: generate + send link. Track as "message sent" disposition. |
| Email campaigns | KZ cleaning market uses WhatsApp, not email for repeat sales. Email = wasted dev time. | WhatsApp only. |
| Mobile app | Managers work at desks. Mobile adds 3-4x development complexity for zero near-term value. | Responsive web only. |
| Predictive dialing / auto-dialer | Legal grey area, requires telephony API (e.g. Twilio), overkill for 3-5 managers. | Manual click-to-call: show phone number prominently, manager dials from their phone. |
| Built-in CRM payment processing | Agbis handles billing. Duplicating it creates reconciliation headaches. | Record order value in CRM for analytics only; actual payment stays in Agbis. |
| Complex permissions / teams / departments | 3-5 managers + 1 owner. YAGNI. | Two roles: manager / admin. Done. |
| Gamification (leaderboards, badges) | Adds complexity, can create unhealthy competition. KPI dashboard is enough. | Simple per-manager stats visible to themselves and owner. |

---

## Feature Dependencies

```
Phone normalization (import)
  └── Deduplication
        └── Client database
              └── Call queue
                    ├── Call disposition
                    │     └── Call-back scheduling
                    └── Order creation
                          ├── Discount grid (auto-apply)
                          └── Manager KPI (revenue won)

Client database
  └── RFM segmentation
        └── Segment-targeted campaigns
              └── Call queue (populated from segment)

Order creation + Client history
  └── Repeat rate metric
  └── Financial impact calculator

Manager KPI dashboard
  └── Bonus calculator (depends on plan targets)
```

---

## MVP Recommendation

Strict MVP for "15 May 2026 in production" deadline. One day from today.

### Must ship (blocker = product doesn't work)

1. **Client import with deduplication** — 21K records normalized, phone-deduplicated, loaded into Supabase
2. **Call queue** — sorted list of clients by days since last order, per-manager view, no overlap
3. **Call disposition** — reached / not reached / call back. Updates client status.
4. **Order creation from CRM** — 4 service types, discount auto-applied, saved to DB
5. **WhatsApp message generation** — OpenRouter call, wa.me deep link, manager clicks to send
6. **Basic manager KPI** — calls today, orders created, revenue for current day/week
7. **Role access** — manager vs admin, Supabase Auth

### Ship if time allows (valuable but not blocking)

8. **RFM segmentation labels** — computed at query time, visible on client card
9. **Repeat rate metric** — single query, shown on owner dashboard
10. **Call-back scheduling** — next_call_date field + queue filter

### Defer to next phase (real complexity, not day-1 blocking)

11. **Financial impact calculator** — requires validated discount model first
12. **Bonus calculator** — requires plan targets defined and first week of real data
13. **Segment-targeted campaigns** — nice once base is proven

---

## Phase-Specific Complexity Notes

| Feature | Phase | Risk | Mitigation |
|---------|-------|------|-----------|
| Phone deduplication | Import | Kazakh numbers: +7, 8, 77, local format chaos | Normalize to E.164 (+7XXXXXXXXXX) before dedup. Reject non-10-digit after strip. |
| Manager queue non-overlap | Core CRM | Race condition: two managers pick same client | Optimistic lock: UPDATE clients SET assigned_to = $manager WHERE assigned_to IS NULL AND id = $id. Check rows affected = 1. |
| Discount auto-apply | Order creation | Business rules change. Hardcoded = maintenance pain | Store discount rules in config table. Single function computes tier. |
| Financial calculator | Analytics | Model complexity, cash gap sensitivity | Simple linear model first. Sliders: orders, avg check, discount rate. No Monte Carlo. |
| Bonus calculator | KPI | Requires "plan" baseline which doesn't exist yet | Block until owner defines monthly plan targets. Stub with placeholder. |
| RFM thresholds | Analytics | What's "At Risk" for carpet cleaning? 90 days? 180? | Default: New (<1 order), Repeat (2-3 orders, <6mo), Loyal (3+ orders), At Risk (last order >90d), Lost (>180d). Make configurable. |

---

## Sources

- [Carpet Cleaning CRM - Bella FSM](https://www.bellafsm.com/industries/carpet-cleaning-software/crm/)
- [CRM for Cleaning Business Growth - ZenMaid](https://www.zenmaid.com/magazine/crm-for-cleaning-business-growth/)
- [9 Best CRM Tools to Upsell Cleaning Services](https://carpetcleanermarketingmasters.com/9-best-crm-tools-to-upsell-cleaning-services/)
- [CRM Deduplication Guide - RT Dynamic](https://www.rtdynamic.com/blog/crm-deduplication-guide-2025/)
- [WhatsApp CRM Integration - Infobip](https://www.infobip.com/blog/whatsapp-crm)
- [RFM Analysis - CleverTap](https://clevertap.com/blog/rfm-analysis/)
- [KPI Bonus Definition & Calculation - Qobra](https://www.qobra.co/blog/kpi-bonus)
- [Employee Performance KPIs for Service Businesses - Orderry](https://orderry.com/blog/employees-performance-with-kpi/)
- [Outbound Calling CRM Workflows - Monday](https://monday.com/blog/crm-and-sales/outbound-calling-software/)
