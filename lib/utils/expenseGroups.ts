// lib/utils/expenseGroups.ts

/** Same name whatever the case or spacing - how names are told apart. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const wordsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** What the Expense Report calls everything paid to staff as pay: "Salary Expenses". */
export const SALARY_HEADER = 'Salary Expenses';

/** Whether an expense name is pay to staff - "Salary Advance", "Employee Advance", "Staff Advance",
 * "Salary Expenses". They are one thing under several names, so the Expense Report keeps them
 * under one header and calls it SALARY_HEADER. */
export function isSalaryName(name: string): boolean {
  return (
    (/\b(employees?|staff|salary)\b/i.test(name) && /\badvance\b/i.test(name)) || /\bsalary\s+expenses?\b/i.test(name)
  );
}

/** A heading as the Expense Report shows it: it always says "Expenses". "Fuel" -> "Fuel Expenses",
 * "Bike Repair" -> "Bike Repair Expenses"; a name that already says it (or abbreviates it) keeps its
 * words and gets the whole word - "Lunch Exp" -> "Lunch Expenses", "Recharge Expenses" as it is. */
export function expenseHeading(label: string): string {
  const name = label.trim().replace(/\s+/g, ' ');
  const spelled = name.replace(/\bexp\.?(?=\W|$)/gi, 'Expenses').replace(/\bexpense\b/gi, 'Expenses');
  return /\bexpenses\b/i.test(spelled) ? spelled : `${spelled} Expenses`;
}

/** The name a category is shown under in the report: the salary ones all read "Salary Expenses",
 * every other one as it is saved. (Only the report's wording - the category itself is not renamed.) */
export function reportCategoryName(name: string): string {
  return isSalaryName(name) ? SALARY_HEADER : name;
}

/** The category each expense name belongs to, from the words it starts with: "Fuel Aviator",
 * "Fuel Manish" and "Fuel" are all Fuel; "Bike Repair 220 Blue" and "Bike Repair Aviator" are
 * Bike Repair - the words every name in the group starts with. A name that no other shares a
 * first word with is its own category.
 *
 * Returns nameKey(name) -> the category's label. */
export function groupExpenseNames(names: readonly string[]): Map<string, string> {
  const byFirstWord = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const name of names) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const first = key.split(' ')[0];
    const members = byFirstWord.get(first);
    if (members) members.push(name.trim().replace(/\s+/g, ' '));
    else byFirstWord.set(first, [name.trim().replace(/\s+/g, ' ')]);
  }

  const labelOf = new Map<string, string>();
  for (const members of byFirstWord.values()) {
    let common = wordsOf(members[0]);
    for (const member of members.slice(1)) {
      const words = wordsOf(member);
      let i = 0;
      while (i < common.length && i < words.length && common[i].toLowerCase() === words[i].toLowerCase()) i++;
      common = common.slice(0, i);
    }
    const label = members.length > 1 ? common.join(' ') : members[0];
    for (const member of members) labelOf.set(nameKey(member), label);
  }
  return labelOf;
}
