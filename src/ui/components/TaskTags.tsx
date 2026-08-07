import * as React from "react";

export const TaskTags: React.FC<{ tags: readonly string[] | undefined }> = ({ tags }) => {
  if (!tags?.length) return null;
  return (
    <div className="tm-flex tm-flex-wrap tm-gap-1 tm-mt-2" aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="tm-rounded tm-bg-tm-bg-alt tm-px-1.5 tm-py-0.5 tm-text-xs tm-text-tm-muted">
          #{tag}
        </span>
      ))}
    </div>
  );
};
