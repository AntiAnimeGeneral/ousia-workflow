use crate::analysis::{AnalysisSession, FatalError};

mod inventory;
mod model;
mod render;

#[cfg(test)]
mod tests;

#[doc = "ousia: ownerless-fn function usage report application"]
pub(crate) fn build_session(session: &mut AnalysisSession) -> Result<String, FatalError> {
    let inventory = inventory::FunctionInventory::from_session(session);
    Ok(render::render_rows(
        &inventory.functions,
        inventory.callers(),
    ))
}
