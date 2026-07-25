use crate::crate_ast::ParsedCrateSet;

mod inventory;
mod model;
mod render;
mod resolution;

#[cfg(test)]
mod tests;

pub(crate) struct FunctionUsageReport;

impl FunctionUsageReport {
    #[doc = "ousia: ownerless-method usage report construction is a static helper"]
    pub(crate) fn build(parsed: &ParsedCrateSet) -> Result<String, std::io::Error> {
        let inventory = inventory::FunctionInventory::from_crate_set(parsed);
        let callers = inventory.callers_by_function(parsed);
        Ok(render::render_rows(&inventory.functions, &callers))
    }
}
