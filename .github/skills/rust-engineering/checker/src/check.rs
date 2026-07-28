use std::path::{Path, PathBuf};

use crate::analysis;
use crate::diagnostic::Diagnostic;
use crate::engine;
use crate::rules;
use crate::test_analysis;

#[derive(Debug)]
pub enum CheckOutcome {
    Passed,
    Invalid(Vec<Diagnostic>),
}

pub enum ProjectCheckResult {
    Checked(CheckOutcome),
    NotApplicable,
}

#[doc = "ousia: ownerless-fn public Rust checker Cargo input orchestration"]
pub fn check_cargo_inputs(cargo_inputs: &[PathBuf]) -> Result<CheckOutcome, analysis::FatalError> {
    let mut session = analysis::AnalysisSession::build(cargo_inputs)?;
    let mut diagnostics = Vec::new();
    let mut owner_lineage = rules::module_owner::Lineage::default();
    for module in session.production_modules()? {
        let inherited_owner = owner_lineage.inherited(module.parent_occurrence_id());
        let result = engine::RuleEngine::new(module.path()).check_module(
            &module,
            inherited_owner.as_ref().map(|(_, name)| name.as_str()),
        );
        owner_lineage.settle(module.occurrence_id(), inherited_owner, result.ownership);
        diagnostics.extend(result.diagnostics);
    }
    diagnostics.extend(owner_lineage.finish());
    let inventory = test_analysis::TestContractInventory::build_session(&mut session)?;
    diagnostics.extend(rules::test_contract::diagnostics(&inventory));
    if diagnostics.is_empty() {
        Ok(CheckOutcome::Passed)
    } else {
        Ok(CheckOutcome::Invalid(diagnostics))
    }
}

#[doc = "ousia: ownerless-fn public host-project Rust validation orchestration"]
pub fn check_project(project_root: &Path) -> Result<ProjectCheckResult, analysis::FatalError> {
    match analysis::subject::resolve_project(project_root)? {
        analysis::subject::ProjectSubject::Paths(cargo_inputs) => {
            check_cargo_inputs(&cargo_inputs).map(ProjectCheckResult::Checked)
        }
        analysis::subject::ProjectSubject::NotApplicable => Ok(ProjectCheckResult::NotApplicable),
    }
}
