/**
 * SPDX-FileComment: Main application entry point
 * SPDX-FileType: SOURCE
 * SPDX-FileContributor: ZHENG Robert
 * SPDX-FileCopyrightText: 2026 ZHENG Robert
 * SPDX-License-Identifier: MIT
 *
 * @file upload_engine.cpp
 * @brief WASM build with Emscripten for a parallel upload engine. It receives messages to create upload plans and report chunk results, and responds with progress updates and next chunk assignments.
 * @version 0.1.0
 * @date 2026-03.17
 *
 * @author ZHENG Robert (robert@hase-zheng.net)
 * @copyright Copyright (c) 2026 ZHENG Robert
 *
 * @license MIT License
 */

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include "json.hpp"

using json = nlohmann::json;

extern "C" {

// --- Helpers to read/write strings from/to linear memory (Emscripten heap addresses) ---
static std::string read_string(uint32_t ptr, uint32_t len) {
    const char* p = reinterpret_cast<const char*>(ptr);
    return std::string(p, p + len);
}

// write up to cap bytes, return actual written length
static uint32_t write_string_limited(uint32_t ptr, uint32_t cap, const std::string& s) {
    uint32_t n = static_cast<uint32_t>(s.size());
    uint32_t to_write = (n <= cap) ? n : cap;
    if (to_write > 0) {
        char* p = reinterpret_cast<char*>(ptr);
        std::memcpy(p, s.data(), to_write);
    }
    return to_write;
}

// --- Upload engine state ---
struct Chunk {
    std::string chunk_id;
    std::string file_id;
    uint64_t offset;
    uint64_t size;
};

static std::vector<Chunk> plan;
static size_t next_idx = 0;
static uint64_t total_bytes = 0;
static uint64_t uploaded_bytes = 0;
static uint32_t max_parallel = 1;
static uint32_t in_flight = 0;

static json make_next_requests(uint32_t count) {
    json arr = json::array();
    while (count > 0 && next_idx < plan.size()) {
        const auto& c = plan[next_idx++];
        arr.push_back({
            {"chunk_id", c.chunk_id},
            {"file_id",  c.file_id},
            {"offset",   c.offset},
            {"size",     c.size}
        });
        ++in_flight;
        --count;
    }
    return arr;
}

static json handle_upload_job(const json& msg) {
    const auto& job = msg.at("payload");
    const auto& files = job.at("files");
    const auto& chunking = job.at("chunking");

    uint64_t chunk_size = chunking.value("chunk_size", 8ull * 1024ull * 1024ull);
    max_parallel = chunking.value("max_parallel", 1u);

    plan.clear();
    next_idx = 0;
    total_bytes = 0;
    uploaded_bytes = 0;
    in_flight = 0;

    for (const auto& f : files) {
        std::string file_id = f.at("file_id").get<std::string>();
        uint64_t size = f.at("size").get<uint64_t>();
        total_bytes += size;

        uint64_t offset = 0;
        while (offset < size) {
            uint64_t rem = size - offset;
            uint64_t this_size = rem < chunk_size ? rem : chunk_size;

            plan.push_back({
                file_id + ":" + std::to_string(offset),
                file_id,
                offset,
                this_size
            });

            offset += this_size;
        }
    }

    json resp;
    resp["type"] = "PLAN_CREATED";
    resp["payload"]["chunks"] = json::array();
    for (const auto& c : plan) {
        resp["payload"]["chunks"].push_back({
            {"chunk_id", c.chunk_id},
            {"file_id",  c.file_id},
            {"offset",   c.offset},
            {"size",     c.size}
        });
    }
    resp["payload"]["max_parallel"] = max_parallel;
    resp["payload"]["next_chunk_requests"] = make_next_requests(max_parallel);
    return resp;
}

static json handle_chunk_result(const json& msg) {
    const auto& p = msg.at("payload");
    bool success = p.at("success").get<bool>();
    std::string chunk_id = p.at("chunk_id").get<std::string>();

    if (in_flight > 0) --in_flight;

    if (success) {
        auto it = std::find_if(plan.begin(), plan.end(),
                               [&](const Chunk& e){ return e.chunk_id == chunk_id; });
        if (it != plan.end()) uploaded_bytes += it->size;
    }

    json resp;
    resp["type"] = "PROGRESS";
    auto& pl = resp["payload"];
    pl["bytes_total"] = total_bytes;
    pl["bytes_uploaded"] = uploaded_bytes;

    bool all_assigned = (next_idx >= plan.size());
    bool all_done = all_assigned && (in_flight == 0);

    if (!all_done) {
        uint32_t can_assign = max_parallel > in_flight ? (max_parallel - in_flight) : 0u;
        pl["next_chunk_requests"] = make_next_requests(can_assign);
    } else {
        pl["job_done"] = true;
    }

    return resp;
}

// C ABI: inPtr,inLen,outPtr,outCap -> returns written length
uint32_t wasm_handle_message(uint32_t in_ptr, uint32_t in_len,
                             uint32_t out_ptr, uint32_t out_cap) {
    try {
        std::string s = read_string(in_ptr, in_len);
        json msg = json::parse(s);

        json resp;
        std::string type = msg.at("type").get<std::string>();

        if (type == "UPLOAD_JOB") {
            resp = handle_upload_job(msg);
        } else if (type == "CHUNK_RESULT") {
            resp = handle_chunk_result(msg);
        } else {
            resp["type"] = "ERROR";
            resp["payload"]["message"] = "Unknown message type";
        }

        std::string out = resp.dump();
        uint32_t written = write_string_limited(out_ptr, out_cap, out);
        return written;
    } catch (const std::exception& ex) {
        json err;
        err["type"] = "ERROR";
        err["payload"]["message"] = ex.what();
        std::string out = err.dump();
        uint32_t written = write_string_limited(out_ptr, out_cap, out);
        return written;
    }
}

} // extern "C"
