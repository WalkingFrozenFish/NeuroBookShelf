import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icons";

export function EmptyState({ icon, title, children, action }: {
  icon: ComponentProps<typeof Icon>["name"];
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return <div className="empty-card">
    <span className="empty-card-icon"><Icon name={icon} /></span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
    {action && <div className="actions">{action}</div>}
  </div>;
}
