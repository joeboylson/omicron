import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { setBoardRules } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Textarea } from "@/components/ui/textarea";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import type { SectionProps } from "@/components/settings/types";

/** The usual rules (#277): what a session does in each case, to start from.
 *  The same as `LoopRules::usual` in the Rust code, said to loops when a
 *  Project has no board rules of its own. */
export const USUAL_RULES = [
  "If you have a question: don't ask it here. Write it as a comment on its task (`omicron tasks comment`) and go on to the next thing.",
  "If you need more information: look in the task's notes and comments, the Project's other tasks and this folder first; if it still isn't there, treat it as a question.",
  "When you finish something: comment on the task saying what you did, and move it to the status that fits.",
  "If you need a person to do something: comment on the task saying exactly what's needed and from whom, and go on to the next thing.",
  "If there's nothing left to do: say so in one line and end your turn; the next run checks again.",
].join("\n");

/** The Project's board rules (#277): what its columns mean and how work
 *  moves, given to its sessions with every task and every loop. */
export function BoardRulesSection({ project, change }: SectionProps) {
  const { db } = useApp();
  const [rules, setRules] = useState(project.run_rules);
  useEffect(() => setRules(project.run_rules), [project.run_rules]);
  const save = (text: string) => {
    if (text.trim() !== project.run_rules.trim()) change(() => setBoardRules(db, project.id, text.trim()));
  };
  return (
    <Group title={<label htmlFor="board-rules">Board rules</label>}>
      <Row className="py-2">
        <Textarea
          id="board-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          onBlur={() => save(rules)}
          placeholder="What the columns mean and how work moves. For example: Done work goes to Review. Questions go to Waiting on Joe."
          rows={8}
          className={cn(bare, "min-h-32 px-0 py-1")}
        />
      </Row>
      {!rules.trim() && (
        <Row>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-11 text-link sm:h-9"
            onClick={() => {
              setRules(USUAL_RULES);
              save(USUAL_RULES);
            }}
          >
            Start From the Usual Rules
          </Button>
        </Row>
      )}
    </Group>
  );
}
