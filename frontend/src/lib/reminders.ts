import type { CollectionItem } from "../api/types";
import type { Formatters } from "../i18n";

export type Channel = "whatsapp" | "sms" | "email";
export type Lang = "ar" | "en" | "both";

/** Polite, bilingual payment reminders in the register Saudi B2B customers expect. */
export function reminderText(item: CollectionItem, company: { name: string; name_ar: string | null }, channel: Channel, lang: Lang, fa: Formatters, fe: Formatters): string {
  const amountAr = `${fa.number(item.outstanding)} ر.س`;
  const amountEn = `SAR ${fe.number(item.outstanding)}`;
  const dueAr = fa.date(item.due_date, "medium");
  const dueEn = fe.date(item.due_date, "medium");
  const companyAr = company.name_ar || company.name;
  const customerAr = item.counterparty_ar || item.counterparty;
  const short = channel !== "email";

  const ar = (() => {
    const greet = `السلام عليكم ورحمة الله،\nالسادة ${customerAr} المحترمين،`;
    const ref = `الفاتورة رقم ${item.number} بقيمة ${amountAr}`;
    const body =
      item.tone === "friendly"
        ? `نود تذكيركم بلطف بأن ${ref} تستحق بتاريخ ${dueAr}.`
        : item.tone === "firm"
          ? `نود إفادتكم بأن ${ref} كانت مستحقة بتاريخ ${dueAr}، ومضى على استحقاقها ${item.days_overdue} يوماً.`
          : `نذكّركم بأن ${ref} متأخرة منذ ${item.days_overdue} يوماً (تاريخ الاستحقاق ${dueAr})، ونأمل تسويتها خلال هذا الأسبوع.`;
    const ask = short ? "نأمل التكرم بالسداد أو إفادتنا بالموعد المتوقع." : "نأمل التكرم بسداد المبلغ أو إفادتنا بموعد السداد المتوقع، وفي حال تم السداد نرجو تجاهل هذه الرسالة.";
    const zatca = !short && item.zatca_uuid ? `\nالرقم المرجعي للفاتورة الإلكترونية (فاتورة): ${item.zatca_uuid}` : "";
    return `${greet}\n\n${body}\n${ask}${zatca}\n\nشاكرين تعاونكم،\n${companyAr}`;
  })();

  const en = (() => {
    const greet = `Dear ${item.counterparty} team,`;
    const ref = `invoice ${item.number} for ${amountEn}`;
    const body =
      item.tone === "friendly"
        ? `A friendly reminder that ${ref} is due on ${dueEn}.`
        : item.tone === "firm"
          ? `Our records show ${ref} was due on ${dueEn} and is now ${item.days_overdue} days overdue.`
          : `${ref.charAt(0).toUpperCase() + ref.slice(1)} is now ${item.days_overdue} days overdue (due ${dueEn}). We would appreciate settlement this week.`;
    const ask = short ? "Could you confirm the payment date?" : "Could you arrange payment or let us know the expected payment date? If you have already paid, please ignore this message.";
    const zatca = !short && item.zatca_uuid ? `\nZATCA e-invoice reference: ${item.zatca_uuid}` : "";
    return `${greet}\n\n${body}\n${ask}${zatca}\n\nThank you,\n${company.name}`;
  })();

  const text = lang === "ar" ? ar : lang === "en" ? en : `${ar}\n\n———\n\n${en}`;
  if (channel === "email") {
    const subject = lang === "en" ? `Payment reminder: ${item.number}` : `تذكير بالسداد: ${item.number}${lang === "both" ? ` · Payment reminder` : ""}`;
    return `${lang === "en" ? "Subject" : "الموضوع"}: ${subject}\n\n${text}`;
  }
  return text;
}
