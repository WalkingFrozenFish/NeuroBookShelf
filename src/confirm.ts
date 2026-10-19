export async function confirmAction(message: string): Promise<boolean> {
  try {
    const result = window.confirm(message) as boolean | Promise<boolean>;
    return await result;
  } catch {
    return false;
  }
}
