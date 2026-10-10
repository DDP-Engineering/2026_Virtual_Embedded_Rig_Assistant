import { Activity } from "lucide-react";
import { Card } from "./components/ui/card.js";

export function App() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <Card className="flex w-72 items-center justify-center gap-4 p-8">
        <Activity className="size-8 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-wide">VERA</h1>
      </Card>
    </main>
  );
}
