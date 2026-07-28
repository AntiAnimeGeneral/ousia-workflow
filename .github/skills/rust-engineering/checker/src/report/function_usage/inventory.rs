use std::collections::{BTreeMap, BTreeSet};

use crate::analysis::AnalysisSession;

use super::model::{FunctionDefinition, FunctionKey};

pub(super) struct FunctionInventory {
    pub(super) functions: BTreeMap<FunctionKey, FunctionDefinition>,
    callers: BTreeMap<FunctionKey, BTreeSet<FunctionKey>>,
}

impl FunctionInventory {
    pub(super) fn from_session(session: &AnalysisSession) -> Self {
        let mut inventory = Self {
            functions: BTreeMap::new(),
            callers: BTreeMap::new(),
        };
        for definition in session.callables().definitions() {
            inventory
                .functions
                .entry(FunctionKey {
                    target: definition.target.to_owned(),
                    path: definition.path.to_vec(),
                })
                .or_insert_with(|| FunctionDefinition {
                    location: definition.location.to_owned(),
                });
        }
        for usage in session.callables().resolved_usages() {
            inventory
                .callers
                .entry(FunctionKey {
                    target: usage.callee_target.to_owned(),
                    path: usage.callee_path.to_vec(),
                })
                .or_default()
                .insert(FunctionKey {
                    target: usage.caller_target.to_owned(),
                    path: usage.caller_path.to_vec(),
                });
        }
        inventory
    }

    pub(super) fn callers(&self) -> &BTreeMap<FunctionKey, BTreeSet<FunctionKey>> {
        &self.callers
    }
}
