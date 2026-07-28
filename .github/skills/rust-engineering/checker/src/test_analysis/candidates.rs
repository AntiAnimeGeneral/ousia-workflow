use std::collections::{BTreeMap, BTreeSet};

use super::model::{CandidateGroup, TestEntry};

impl CandidateGroup {
    pub(super) fn from_tests(tests: &[TestEntry]) -> Vec<Self> {
        let mut candidates = Vec::new();
        let mut exact = BTreeMap::<&str, Vec<&TestEntry>>::new();
        for test in tests {
            exact
                .entry(&test.fingerprints.exact_body_sha256)
                .or_default()
                .push(test);
        }
        for (fingerprint, group) in exact.into_iter().filter(|(_, group)| group.len() >= 2) {
            candidates.push(Self {
                code: "exact-test-body-clone",
                confidence: "high",
                tests: group.iter().map(|test| test.test_id.clone()).collect(),
                evidence: vec![format!("comparison shape sha256={fingerprint}")],
            });
        }
        let mut matrices = BTreeMap::<String, Vec<&TestEntry>>::new();
        for test in tests
            .iter()
            .filter(|test| test.contract.status == "complete")
        {
            let scope = &test.contract.scope;
            let key = format!(
                "{}:{}:{}:{}:{}:{}:{:?}",
                test.root_id,
                test.target.kind,
                test.target.name,
                test.module,
                scope.level.as_deref().unwrap_or(""),
                scope.boundary.as_deref().unwrap_or(""),
                test.fingerprints.literal_normalized_sha256,
            );
            matrices.entry(key).or_default().push(test);
        }
        for group in matrices.into_values().filter(|group| {
            group.len() >= 2
                && group
                    .iter()
                    .map(|test| &test.fingerprints.exact_body_sha256)
                    .collect::<BTreeSet<_>>()
                    .len()
                    >= 2
                && group
                    .iter()
                    .map(|test| &test.facts.oracles)
                    .collect::<BTreeSet<_>>()
                    .len()
                    == 1
        }) {
            candidates.push(Self {
                code: "parameter-matrix-candidate",
                confidence: "medium",
                tests: group.iter().map(|test| test.test_id.clone()).collect(),
                evidence: vec![format!(
                    "literal-normalized shape sha256={}",
                    group[0].fingerprints.literal_normalized_sha256
                )],
            });
        }
        for test in tests {
            let owners = test
                .facts
                .direct_function_calls
                .iter()
                .filter_map(|path| owner_family(path))
                .collect::<BTreeSet<_>>();
            if owners.len() >= 2 {
                candidates.push(Self {
                    code: "multi-contract-test",
                    confidence: "low",
                    tests: vec![test.test_id.clone()],
                    evidence: vec![format!(
                        "direct call owner families: {}",
                        owners.into_iter().collect::<Vec<_>>().join(", ")
                    )],
                });
            }
            if test.facts.oracles.is_empty() {
                candidates.push(Self {
                    code: "weak-oracle-candidate",
                    confidence: "low",
                    tests: vec![test.test_id.clone()],
                    evidence: vec!["no source-visible oracle was collected".to_owned()],
                });
            }
        }
        candidates.sort_by(|left, right| {
            left.code
                .cmp(right.code)
                .then_with(|| left.tests.cmp(&right.tests))
        });
        candidates
    }
}

#[doc = "ousia: ownerless-fn candidate direct-call owner-family projection"]
fn owner_family(path: &str) -> Option<String> {
    let mut segments = path
        .split("::")
        .filter(|segment| !segment.is_empty())
        .peekable();
    while matches!(segments.peek(), Some(&"crate" | &"self" | &"super")) {
        segments.next();
    }
    let owner = segments.next()?;
    let has_member = segments.next().is_some();
    if !has_member || matches!(owner, "std" | "core" | "alloc") {
        return None;
    }
    Some(owner.to_owned())
}
