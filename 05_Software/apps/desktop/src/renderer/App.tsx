import { useQuery } from "@tanstack/react-query";
import { veraErrorSchema } from "@vera/shared";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "./api/index.js";
import { Card } from "./components/ui/card.js";

export function App() {
  const { t } = useTranslation();
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const error = veraErrorSchema.safeParse(info.error);
  return (
    <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <Card className="w-96 space-y-6 p-8">
        <div className="flex items-center justify-center gap-4">
          <Activity className="size-8 text-primary" aria-hidden="true" />
          <h1 data-i18n="home.title" className="text-2xl font-semibold tracking-wide">
            {t("home.title")}
          </h1>
        </div>
        {info.isPending && (
          <p role="status" data-i18n="home.loading">
            {t("home.loading")}
          </p>
        )}
        {info.isError && (
          <p role="alert" data-i18n={error.success ? error.data.messageKey : "errors.INTERNAL"}>
            {t(
              error.success ? error.data.messageKey : "errors.INTERNAL",
              error.success ? (error.data.params ?? {}) : {},
            )}
          </p>
        )}
        {info.data && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {(["name", "version", "platform", "arch", "portable", "locale"] as const).map((field) => (
              <div key={field} className="contents">
                <dt data-i18n={`home.${field}`} className="text-muted-foreground">
                  {t(`home.${field}`)}
                </dt>
                <dd data-info={field}>
                  {field === "portable" ? t(info.data.portable ? "home.yes" : "home.no") : info.data[field]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </main>
  );
}
