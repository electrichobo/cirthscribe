//! Rust side of the model contract with the editor (fixtures/model-contract.json;
//! the TypeScript side is app/tests/contract.mjs). Field names, omission rules
//! and block kinds must match exactly, or edits could lose fields in transit.

use cirth_core::model::{Beat, Block, BlockKind};
use cirth_core::ops::Batch;
use serde_json::Value;

fn contract() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/model-contract.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

/// Deserialize and serialize again: the result must be the same JSON.
fn round_trip<T: serde::de::DeserializeOwned + serde::Serialize>(v: &Value) -> Value {
    serde_json::to_value(serde_json::from_value::<T>(v.clone()).unwrap()).unwrap()
}

#[test]
fn block_kinds_match() {
    let c = contract();
    let rust: Vec<&str> = BlockKind::ALL.iter().map(|k| k.as_str()).collect();
    let wire: Vec<&str> = c["kinds"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
    assert_eq!(rust, wire);
}

#[test]
fn blocks_beats_and_batches_round_trip_exactly() {
    let c = contract();
    for b in c["blocks"].as_array().unwrap() {
        assert_eq!(&round_trip::<Block>(b), b);
    }
    assert_eq!(round_trip::<Vec<Beat>>(&c["beats"]), c["beats"]);
    assert_eq!(round_trip::<Batch>(&c["batch"]), c["batch"]);
}

#[test]
fn the_fixture_covers_every_kind_and_field() {
    // Guards the contract itself: shrinking the fixture must not hide a field.
    let c = contract();
    let blocks: Vec<Block> = serde_json::from_value(c["blocks"].clone()).unwrap();
    for k in BlockKind::ALL {
        assert!(blocks.iter().any(|b| b.kind == k), "no {k:?} block");
    }
    assert!(blocks.iter().any(|b| b.dual));
    assert!(blocks.iter().any(|b| b.break_before));
    assert!(blocks.iter().any(|b| b.scene_id.is_some()));
    let runs: Vec<_> = blocks.iter().flat_map(|b| &b.runs).collect();
    assert!(runs.iter().any(|r| r.bold) && runs.iter().any(|r| r.italic) && runs.iter().any(|r| r.underline));
    let ops: Vec<&str> = c["batch"]["ops"].as_array().unwrap().iter().map(|o| o["op"].as_str().unwrap()).collect();
    for op in ["put", "update", "delete"] {
        assert!(ops.contains(&op), "no {op} op");
    }
}
