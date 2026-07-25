#![doc = "ousia: module-owner rust-checker-function-usage-render"]

use std::collections::{BTreeMap, BTreeSet};

use super::model::{FunctionDefinition, FunctionKey, ReportRow};

pub(super) fn render_rows(
    functions: &BTreeMap<FunctionKey, FunctionDefinition>,
    callers: &BTreeMap<FunctionKey, BTreeSet<FunctionKey>>,
) -> String {
    let mut rows = Vec::new();
    for (function, definition) in functions {
        let function_callers = callers.get(function).cloned().unwrap_or_default();
        let caller_list = function_callers
            .iter()
            .map(format_function_path)
            .collect::<Vec<_>>()
            .join(",");
        rows.push(ReportRow {
            used_by_functions: function_callers.len(),
            target: function.target.clone(),
            function: format_function_path(function),
            callers: caller_list,
            location: definition.location.clone(),
        });
    }
    rows.sort_by(|left, right| {
        right
            .used_by_functions
            .cmp(&left.used_by_functions)
            .then_with(|| left.target.cmp(&right.target))
            .then_with(|| left.function.cmp(&right.function))
    });
    let mut output = String::from("used_by_functions\ttarget\tfunction\tcallers\tlocation\n");
    for row in rows {
        output.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\n",
            row.used_by_functions, row.target, row.function, row.callers, row.location,
        ));
    }
    output
}

pub(super) fn format_function_path(function: &FunctionKey) -> String {
    let display_root = function
        .target
        .split(':')
        .next()
        .unwrap_or(&function.target);
    format!("{}::{}", display_root, function.path.join("::"),)
}
