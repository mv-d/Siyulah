export type Severity = "critical" | "serious" | "warning" | "info" | "good";

export interface CompanySummary {
  id: number;
  name: string;
  name_ar: string | null;
  sector: "retail" | "services";
  city: string;
  min_cash_buffer: number;
  currency: string;
}

export interface Me {
  id: number;
  email: string;
  full_name: string;
  locale: "ar" | "en";
  company: CompanySummary;
}

export interface ForecastEvent {
  date: string;
  kind: string;
  label_en: string;
  label_ar: string;
  amount: number;
  ref: string | null;
  probability?: number;
}

export interface ForecastPoint {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  inflow: number;
  outflow: number;
  events: ForecastEvent[];
}

export interface HistoryPoint {
  date: string;
  balance: number;
  inflow: number;
  outflow: number;
}

export interface Metrics {
  opening_balance: number;
  ending_balance: number;
  ending_p10: number;
  ending_p90: number;
  lowest_balance: number;
  lowest_date: string;
  lowest_p10: number;
  cash_zero_date: string | null;
  runway_days: number | null;
  buffer_breach_date: string | null;
  risk_date: string | null;
  shortfall_probability: number;
  buffer_breach_probability: number;
  total_inflow: number;
  total_outflow: number;
  net_change: number;
  avg_daily_outflow: number;
  days_below_buffer: number;
  future_invoice_inflow: number;
  future_bill_outflow: number;
  safety_buffer: number;
  horizon: number;
}

export interface ModelInfo {
  method: string;
  simulations: number;
  training_days: number;
  backtest_accuracy: number | null;
  sales_drivers: Record<string, number>;
  expense_drivers: Record<string, number>;
}

export interface ReceivableForecast {
  id: number;
  number: string;
  expected_date: string | null;
  probability_in_horizon: number;
  p10_date: string;
  p90_date: string;
}

export interface Forecast {
  as_of: string;
  horizon: number;
  series: ForecastPoint[];
  metrics: Metrics;
  model: ModelInfo;
  receivables: ReceivableForecast[];
  history: HistoryPoint[];
}

export interface Insight {
  kind: string;
  severity: Severity;
  text_en: string;
  text_ar: string;
}

export interface Adjustment {
  type:
    | "delay_receivable"
    | "expect_receivable"
    | "write_off_receivable"
    | "shift_payable"
    | "shift_obligation"
    | "skip_obligation"
    | "revenue_change"
    | "expense_change"
    | "one_off"
    | "recurring"
    | "loan";
  invoice_id?: number;
  obligation_id?: number;
  days?: number;
  pct?: number;
  date?: string;
  start_date?: string;
  end_date?: string;
  amount?: number;
  months?: number;
  rate_pct?: number;
  frequency?: "weekly" | "monthly" | "quarterly";
  label?: string;
}

export interface Suggestion {
  kind: string;
  title_en: string;
  title_ar: string;
  adjustments: Adjustment[];
  impact: { lowest_balance: number; lowest_balance_change: number; shortfall_probability: number; shortfall_change: number };
}

export interface AlertItem {
  id: number;
  kind: string;
  severity: Severity;
  title_en: string;
  title_ar: string;
  body_en: string;
  body_ar: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
}

export interface Account {
  id: number;
  bank_code: string;
  bank_name: string;
  bank_name_ar: string;
  name: string;
  iban_masked: string | null;
  balance: number;
  currency: string;
  updated_at: string | null;
}

export interface Backtest {
  as_of: string;
  days: number;
  accuracy: number | null;
  band_coverage: number;
  end_predicted: number | null;
  end_actual: number | null;
  excluded_discretionary: number;
}

export interface Dashboard {
  as_of: string;
  company: { name: string; name_ar: string | null; min_cash_buffer: number };
  balance: number;
  accounts: Account[];
  forecast: Forecast;
  insights: Insight[];
  suggestions: Suggestion[];
  receivables: { open_total: number; open_count: number; overdue_total: number; overdue_count: number };
  payables: { due_30_total: number; due_30_count: number; open_total: number };
  upcoming: ForecastEvent[];
  alerts: AlertItem[];
  alerts_unread: number;
  connections: { bank: number; accounting: number; last_synced_at: string | null };
  backtest: Backtest | null;
  has_data: boolean;
}

export interface Invoice {
  id: number;
  kind: "receivable" | "payable";
  number: string;
  source: "accounting" | "manual";
  counterparty: string;
  counterparty_ar: string | null;
  category: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  vat_amount: number;
  amount_paid: number;
  outstanding: number;
  status: "open" | "paid" | "void";
  paid_date: string | null;
  expected_date: string | null;
  zatca_uuid: string | null;
  notes: string | null;
  days_overdue: number;
  aging: string | null;
  customer_avg_delay: number | null;
  forecast?: ReceivableForecast;
}

export interface AgingBucket {
  key: string;
  amount: number;
  count: number;
}

export interface InvoiceSummary {
  receivable: { total: number; overdue: number; due_next_7_days: number; buckets: AgingBucket[] };
  payable: { total: number; overdue: number; due_next_7_days: number; buckets: AgingBucket[] };
  dso_days: number | null;
}

export interface Obligation {
  id: number;
  kind: string;
  name: string;
  name_ar: string | null;
  amount: number;
  frequency: "once" | "monthly" | "quarterly" | "semiannual" | "annual";
  next_due_date: string;
  next_payment_date: string | null;
  occurrences_90d: string[];
  active: boolean;
  source: "detected" | "manual";
  user_modified: boolean;
  notes: string | null;
}

export interface Scenario {
  id: number;
  name: string;
  description: string | null;
  adjustments: Adjustment[];
  created_at: string;
  updated_at: string;
}

export interface ScenarioResult {
  baseline: Forecast;
  scenario: Forecast;
  delta: Record<string, number | null>;
  history: HistoryPoint[];
}

export interface Provider {
  key: string;
  kind: "bank" | "accounting" | "commerce" | "government";
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  scopes: string[];
  status: "available" | "coming_soon";
  needs_institution: boolean;
  color: string;
  tags: string[];
}

export interface Bank {
  code: string;
  name: string;
  name_ar: string;
}

export interface Connection {
  id: number;
  provider: string;
  provider_name: string;
  provider_name_ar: string;
  kind: string;
  institution: string | null;
  institution_name: string | null;
  institution_name_ar: string | null;
  status: string;
  scopes: string[];
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  accounts: number | null;
}

export interface AlertRule {
  kind: string;
  enabled: boolean;
  threshold_amount: number | null;
  threshold_days: number | null;
  threshold_pct: number | null;
  channels: string[];
}

export interface NotificationLog {
  id: number;
  alert_id: number | null;
  channel: string;
  recipient: string | null;
  status: string;
  subject: string | null;
  body: string | null;
  detail: string | null;
  created_at: string;
}

export interface CompanySettings {
  id: number;
  name: string;
  name_ar: string | null;
  sector: string;
  city: string;
  cr_number: string | null;
  vat_number: string | null;
  currency: string;
  min_cash_buffer: number;
  alert_email: string | null;
  alert_phone: string | null;
}

export interface PrivacyInfo {
  data_region: string;
  data_region_ar: string;
  encryption_at_rest: string;
  encryption_at_rest_ar: string;
  password_hashing: string;
  transport: string;
  bank_access: string;
  bank_access_ar: string;
  frameworks_ar: string[];
  consent_recorded_at: string | null;
  retention: string;
  frameworks: string[];
}

export interface AuditEntry {
  id: number;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
}
