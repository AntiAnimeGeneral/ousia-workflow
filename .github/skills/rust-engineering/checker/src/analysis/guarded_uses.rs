use std::collections::BTreeMap;

use super::cfg::CfgExpr;
use super::module_graph::{LogicalInclusionGraph, OccurrenceId, body_items};
use super::projected_items::ProjectedItemIndex;
use super::source_repository::PhysicalSourceRepository;

#[derive(Clone)]
pub(crate) struct GuardedUseLeaf {
    pub(crate) local_name: String,
    pub(crate) source_path: Vec<String>,
    pub(crate) external_absolute: bool,
    pub(crate) guard: CfgExpr,
}

#[derive(Clone)]
pub(crate) struct GuardedUseGlob {
    pub(crate) source_path: Vec<String>,
    pub(crate) external_absolute: bool,
    pub(crate) guard: CfgExpr,
}

#[derive(Default)]
struct GuardedModuleUses {
    leaves: Vec<GuardedUseLeaf>,
    globs: Vec<GuardedUseGlob>,
}

pub(crate) struct GuardedUseIndex {
    modules: BTreeMap<OccurrenceId, GuardedModuleUses>,
}

impl GuardedUseIndex {
    pub(crate) fn build(
        graph: &LogicalInclusionGraph,
        repository: &PhysicalSourceRepository,
        projected: &ProjectedItemIndex,
    ) -> Self {
        let mut modules = BTreeMap::new();
        for occurrence in graph.occurrences() {
            let items = body_items(repository, occurrence.body());
            let projected_module = projected.module(occurrence.id());
            let mut module_uses = GuardedModuleUses::default();
            for item in projected_module
                .items()
                .iter()
                .filter(|item| item.production_possible())
            {
                let syn::Item::Use(usage) = &items[item.ordinal()] else {
                    continue;
                };
                let mut syntax_leaves = Vec::new();
                let mut syntax_globs = Vec::new();
                flatten_use_tree(
                    Vec::new(),
                    &usage.tree,
                    &mut syntax_leaves,
                    &mut syntax_globs,
                );
                module_uses.leaves.extend(syntax_leaves.into_iter().map(
                    |(local_name, source_path)| GuardedUseLeaf {
                        local_name,
                        source_path,
                        external_absolute: usage.leading_colon.is_some(),
                        guard: item.effective_guard().clone(),
                    },
                ));
                module_uses
                    .globs
                    .extend(syntax_globs.into_iter().map(|source_path| GuardedUseGlob {
                        source_path,
                        external_absolute: usage.leading_colon.is_some(),
                        guard: item.effective_guard().clone(),
                    }));
            }
            modules.insert(occurrence.id(), module_uses);
        }
        Self { modules }
    }

    pub(crate) fn module(&self, occurrence: OccurrenceId) -> &[GuardedUseLeaf] {
        self.modules
            .get(&occurrence)
            .map(|module| module.leaves.as_slice())
            .unwrap_or(&[])
    }

    pub(crate) fn globs(&self, occurrence: OccurrenceId) -> &[GuardedUseGlob] {
        self.modules
            .get(&occurrence)
            .map(|module| module.globs.as_slice())
            .unwrap_or(&[])
    }
}

#[doc = "ousia: ownerless-fn shared lexical module path projection"]
pub(crate) fn resolve_local_path(module: &[String], segments: &[String]) -> Option<Vec<String>> {
    let mut resolved = module.to_vec();
    let mut index = 0;
    while index < segments.len() {
        match segments[index].as_str() {
            "crate" => {
                resolved.clear();
                index += 1;
            }
            "self" => index += 1,
            "super" => {
                resolved.pop()?;
                index += 1;
            }
            _ => break,
        }
    }
    resolved.extend(segments[index..].iter().cloned());
    Some(resolved)
}

#[doc = "ousia: ownerless-fn guarded use-tree leaf projection"]
fn flatten_use_tree(
    prefix: Vec<String>,
    tree: &syn::UseTree,
    leaves: &mut Vec<(String, Vec<String>)>,
    globs: &mut Vec<Vec<String>>,
) {
    match tree {
        syn::UseTree::Path(path) => {
            let mut prefix = prefix;
            prefix.push(path.ident.to_string());
            flatten_use_tree(prefix, &path.tree, leaves, globs);
        }
        syn::UseTree::Name(name) => {
            let mut path = prefix;
            let name = name.ident.to_string();
            let local = if name == "self" {
                path.last().cloned().unwrap_or(name)
            } else {
                path.push(name.clone());
                name
            };
            leaves.push((local, path));
        }
        syn::UseTree::Rename(rename) => {
            let mut path = prefix;
            path.push(rename.ident.to_string());
            leaves.push((rename.rename.to_string(), path));
        }
        syn::UseTree::Group(group) => {
            for tree in &group.items {
                flatten_use_tree(prefix.clone(), tree, leaves, globs);
            }
        }
        syn::UseTree::Glob(_) => globs.push(prefix),
    }
}
