import { useEffect, useMemo, useState } from 'react';
import { analyzeScope, releaseForecast, trackingFromHistory, type GitHubIssueRef, type ReleaseForecast, type ScopeAnalysis } from './scope';
import { lastScope, onScopeStored, requestScope, storeScope, useScopeConfig } from './scopeApi';
import { scopeSourceFor, type ScopeSource } from './ScopePanel';
import { chosenScenarios, demoScope } from './scopeDemo';
import type { Project } from './types';

/** Projects with a release card that a forecast could apply to. */
const hasRelease = (p: Project) =>
  !p.descoped && (!!p.releaseDate || !!p.milestones?.some(m => m.releaseDate && m.url));

/** Issues already requested for the Releases row on this page. */
const requested = new Set<string>();

function analysisFor(slug: string, issue: GitHubIssueRef, source: ScopeSource): ScopeAnalysis | null {
  if (import.meta.env.DEV && source === 'demo') {
    const load = demoScope(issue, chosenScenarios.get(issue.url) ?? 'normal');
    return load.status === 'ready' ? analyzeScope(load.tracking) : null;
  }
  const res = lastScope(slug, issue.url);
  if (res?.status !== 'ready') return null;
  return analyzeScope(trackingFromHistory(res.history, res.checkedAt, res.refreshError ?? undefined));
}

/** Scope forecasts for release cards, keyed like `ScheduledRelease.key`.
 *  Each linked issue is requested once per page, and the server answers from its cache.
 *  Newer data loaded by the project editor shows up here too. */
export function useReleaseForecasts(slug: string, projects: Project[]): Map<string, ReleaseForecast> {
  const config = useScopeConfig();
  const [version, setVersion] = useState(0);
  useEffect(() => onScopeStored(() => setVersion(v => v + 1)), []);

  const linked = useMemo(
    () => projects.filter(hasRelease).flatMap(project => {
      const src = scopeSourceFor(project.url, config);
      return src ? [{ project, ...src }] : [];
    }),
    [projects, config],
  );

  useEffect(() => {
    for (const { issue, source } of linked) {
      const key = `${slug}\n${issue.url}`;
      if (source !== 'github' || requested.has(key) || lastScope(slug, issue.url)) continue;
      requested.add(key);
      requestScope(slug, issue.url).then(res => storeScope(slug, issue.url, res));
    }
  }, [slug, linked]);

  return useMemo(() => {
    const out = new Map<string, ReleaseForecast>();
    const analyses = new Map<string, ScopeAnalysis | null>();
    for (const { project, issue, source } of linked) {
      if (!analyses.has(issue.url)) analyses.set(issue.url, analysisFor(slug, issue, source));
      const analysis = analyses.get(issue.url);
      if (!analysis) continue;
      const add = (key: string, milestoneUrl: string | undefined, date: string) => {
        const f = releaseForecast(analysis, milestoneUrl, date);
        if (f) out.set(key, f);
      };
      if (project.releaseDate) add(project.id, undefined, project.releaseDate);
      for (const m of project.milestones ?? []) {
        if (m.releaseDate && m.url) add(`${project.id}:${m.id}`, m.url, m.releaseDate);
      }
    }
    return out;
    // `version` changes whenever a scope response is stored.
  }, [slug, linked, version]);
}
