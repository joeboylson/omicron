import { Confirm } from "@/components/base/confirm";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { addTopic, deleteTopic, renameTopic, type Topic } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import type { SectionProps } from "@/components/settings/types";

export function TopicsSection({ project, change }: SectionProps) {
  const { db } = useApp();
  const [newTopic, setNewTopic] = useState("");
  return (
    <Group
      title="Topics"
    >
      {project.topics.length > 0 && (
        <ul className="divide-y" aria-label="Topics">
          {project.topics.map((t) => (
            <TopicRow key={t.id} topic={t} count={project.tasks.filter((x) => x.topic_id === t.id).length} change={change} />
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = newTopic.trim();
          if (n) change(async () => (await addTopic(db, project, n), setNewTopic("")));
        }}
      >
        <Row>
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
          <Input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="New topic"
            aria-label="New topic"
            className={cn(bare, "px-0")}
          />
          <Button type="submit" variant="ghost" size="sm" aria-label="Add topic" disabled={!newTopic.trim()}>
            Add
          </Button>
        </Row>
      </form>
    </Group>
  );
}

function TopicRow({
  topic,
  count,
  change,
}: {
  topic: Topic;
  count: number;
  change: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const { db } = useApp();
  const [name, setName] = useState(topic.name);
  useEffect(() => setName(topic.name), [topic.name]);
  return (
    <li>
      <Row>
        <Input
          value={name}
          aria-label={`Topic name: ${topic.name}`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(topic.name);
            else if (n !== topic.name) change(() => renameTopic(db, topic, n));
          }}
          className={cn(bare, "px-0")}
        />
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground" aria-label={`${count} tasks`}>
          {count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0 text-destructive hover:text-destructive"
          aria-label={`Remove topic ${topic.name}`}
          // On tasks: it would come off them all, so ask first.
          onClick={() => (count > 0 ? setAsking(true) : change(() => deleteTopic(db, topic)))}
        >
          <Trash2 />
        </Button>
      </Row>
      <Confirm
        open={asking}
        onOpenChange={setAsking}
        title={`Delete “${topic.name}”?`}
        sentence={`It comes off ${count === 1 ? "1 task" : `${count} tasks`}.`}
        action="Delete Topic"
        onConfirm={() => change(() => deleteTopic(db, topic))}
      />
    </li>
  );
}
