import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { setRunRules } from "@/lib/data";
import { Textarea } from "@/components/ui/textarea";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import type { SectionProps } from "@/components/settings/types";

export function RunRulesSection({ project, change }: SectionProps) {
  const { db } = useApp();
  const [rules, setRules] = useState(project.run_rules);
  useEffect(() => setRules(project.run_rules), [project.run_rules]);
  return (
    <Group
      title={<label htmlFor="run-rules">Run rules</label>}
    >
      <Row className="py-2">
        <Textarea
          id="run-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          onBlur={() => {
            if (rules.trim() !== project.run_rules.trim()) change(() => setRunRules(db, project.id, rules.trim()));
          }}
          placeholder="Run the tests the change touches. Commit and push. Report on the task in plain words, then move it to Review."
          rows={5}
          className={cn(bare, "min-h-24 px-0 py-1")}
        />
      </Row>
    </Group>
  );
}
