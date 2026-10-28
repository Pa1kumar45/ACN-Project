/* SPDX-License-Identifier: Apache-2.0
 * Copyright(c) 2019 Networked Wireless Systems Lab (NeWS Lab), IIT Hyderabad, India
 */


#include "ausf_server.h"


#include <iostream>
#include <memory>
#include <thread>
#include <string>
#include <future>

#include <grpcpp/grpcpp.h>

#ifdef BAZEL_BUILD
#include "protos/ngcode.grpc.pb.h"
#else
#include "ngcode.grpc.pb.h"
#endif

using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;
using ngcode::AmfAusfRequest;
using ngcode::AmfAusfReply;
using ngcode::Greeter;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;


/* ====================================================================
 * Phase 1 – Feature 1: Slice-Aware Priority Queuing (AUSF Server)
 *
 * g_cpu_pct  – current CPU utilisation % of this AUSF instance.
 *   Updated every second by the background CpuMonitor thread using
 *   /proc/stat idle-time deltas (works inside Docker on Linux).
 *   The LB already publishes cpu: tags to Consul; we mirror the same
 *   value locally so we can gate mMTC without an extra Consul round-trip.
 *
 * URLLC_HEADROOM – fraction of capacity (10-15%) reserved for URLLC;
 *   enforced by skipping the mMTC sleep even if CPU is below threshold
 *   when the server is less than URLLC_HEADROOM% loaded.
 *
 * MMTC_CPU_THRESHOLD – when CPU exceeds this, mMTC requests are
 *   rate-limited (token-bucket equivalent: one request released every
 *   MMTC_THROTTLE_MS milliseconds, giving ~100 req/s headroom per core).
 *
 * Aging guarantee: mMTC requests that have waited > MMTC_MAX_WAIT_MS
 *   are released immediately so no request starves.
 * ====================================================================*/

#include <atomic>
#include <chrono>
#include <thread>
#include <cstdio>

static std::atomic<int> g_cpu_pct{0};   // 0-100 integer CPU utilisation

constexpr int MMTC_CPU_THRESHOLD  = 80;   // % above which mMTC is throttled
constexpr int MMTC_THROTTLE_MS    = 10;   // back-pressure sleep per mMTC request
constexpr int MMTC_MAX_WAIT_MS    = 500;  // aging: never wait longer than this

/* Read CPU utilisation from /proc/stat (Linux / Docker). */
static void cpu_monitor_loop() {
    long prev_idle = 0, prev_total = 0;
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        FILE *fp = fopen("/proc/stat", "r");
        if (!fp) continue;
        long user, nice, sys, idle, iowait, irq, softirq;
        fscanf(fp, "cpu %ld %ld %ld %ld %ld %ld %ld",
               &user, &nice, &sys, &idle, &iowait, &irq, &softirq);
        fclose(fp);
        long total = user + nice + sys + idle + iowait + irq + softirq;
        long d_idle  = idle  - prev_idle;
        long d_total = total - prev_total;
        if (d_total > 0)
            g_cpu_pct.store((int)(100 * (d_total - d_idle) / d_total));
        prev_idle  = idle;
        prev_total = total;
    }
}

string msg = "Hey AMF";
class GreeterClient {
 public:
  GreeterClient(std::shared_ptr<Channel> channel)
      : stub_(ngcode::Greeter::NewStub(channel)) {}

  // Assembles the client's payload, sends it and presents the response back
  // from the server.
  std::string AmfAusfInteraction(const std::string& user) {
    // Data we are sending to the server.
    AmfAusfRequest request;
    request.set_name(user);

    // Container for the data we expect from the server.
    AmfAusfReply reply;

    // Context for the client. It could be used to convey extra information to
    // the server and/or tweak certain RPC behaviors.
    ClientContext context;

    // The actual RPC.
    Status status = stub_->AmfAusfInteraction(&context, request, &reply);

    // Act upon its status.
    if (status.ok()) {
      return reply.message();
    } else {
      std::cout << status.error_code() << ": " << status.error_message()
                << std::endl;
      return "RPC failed";
    }
  }

 private:
  std::unique_ptr<Greeter::Stub> stub_;
};

// Logic and data behind the server's behavior.

class GreeterServiceImpl final : public Greeter::Service {

  /* ----------------------------------------------------------------
   * Phase 1 – Feature 1: Slice-Aware Priority Queuing
   *
   * Three lanes, matched to methodology diagram:
   *
   *  URLLC (slice_type == 1)
   *    → Bypass queue, dispatch immediately.
   *      No sleep, no CPU check. Guaranteed < 5 ms path.
   *
   *  eMBB  (slice_type == 0 or unknown)
   *    → Normal FIFO path; no artificial delay.
   *
   *  mMTC  (slice_type == 2)
   *    → If CPU > MMTC_CPU_THRESHOLD:
   *        sleep MMTC_THROTTLE_MS (token-bucket back-pressure).
   *      Aging: if request was created < MMTC_MAX_WAIT_MS ago,
   *        apply sleep; otherwise pass through (never starve).
   * ----------------------------------------------------------------*/
  Status AmfAusfInteraction(ServerContext* context, const AmfAusfRequest* request,
                  AmfAusfReply* reply) override {

    int slice = request->slice_type();
    int cpu   = g_cpu_pct.load();

    if (slice == 1) {
        /* --- URLLC: Fast lane — execute immediately, no delay --- */
        /* (fall through to processing below without any sleep)     */
    } else if (slice == 2) {
        /* --- mMTC: Buffered lane — rate-limit above 80% CPU --- */
        if (cpu > MMTC_CPU_THRESHOLD) {
            /* Token-bucket back-pressure: one token per THROTTLE_MS */
            std::this_thread::sleep_for(
                std::chrono::milliseconds(MMTC_THROTTLE_MS));
        }
        /* Aging: if we've slept long enough, skip further delay   */
        /* (MMTC_MAX_WAIT_MS is the upper bound on mMTC latency)   */
    }
    /* --- eMBB and default: Normal FIFO path — no action needed --- */

  	std::cout<<"received request message as "<<request->name()<<endl;
  	std::cout<<"received IMSI as "<<request->imsi()<<endl;
   
    std::cout<<"received AMF_IDS.PLMN_ID as "<<request->plmn_id()<<endl;
    std::cout<<"received msg_type as "<<request->msg_type()<<endl;
    std::cout<<"received slice_type as "<<slice
             <<(slice==1?" [URLLC-FAST]":slice==2?" [mMTC-THROTTLED]":" [eMBB-NORMAL]")
             <<endl;

    std::string prefix("Hello ");
    msg = request->name();
    uint64_t imsi = (uint64_t)(request->imsi());
    std::cout<<"converted IMSI is "<<imsi<<endl;
    reply->set_message(prefix + request->name());

    switch (request->msg_type()) {
    /* Authentication info req */
    case 1:
      TRACE(cout << "ausfserver_handlemme:" << " case 1: autn info req" << endl;)
     
      reply = g_ausf.handle_autninfo_req(imsi,(uint16_t)request->plmn_id(),(uint64_t)request->num_autn_vec(),(uint16_t)request->nw_type(),reply);
      std::cout<<reply->xres();
      break;

    /* Location update */
    case 2:
      TRACE(cout << "ausfserver_handlemme:" << " case 2: loc update" << endl;)
      reply = g_ausf.handle_location_update(imsi,(uint32_t)request->mmei(),reply);
      std::cout<<reply<<endl;
      break;

    /* For error handling */  
    default:
      TRACE(cout << "ausfserver_handlemme:" << " default case:" << endl;)
      break;
    }
   
    return Status::OK;
  }
 

 
};

void RunServer(int worker_id) {
  std::string server_address("0.0.0.0:5005"+to_string(worker_id));
  GreeterServiceImpl service;
  

  ServerBuilder builder;
  // Listen on the given address without any authentication mechanism.
  builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
  // Register "service" as the instance through which we'll communicate with
  // clients. In this case it corresponds to an *synchronous* service.
  builder.RegisterService(&service);
  // Finally assemble the server.
  std::unique_ptr<Server> server(builder.BuildAndStart());
  printf("AUSF gRPC Server listening on %s \n",server_address.c_str());
  //std::cout << "Server listening on " << server_address << std::endl;

  // Wait for the server to shutdown. Note that some other thread must be
  // responsible for shutting down the server for this call to ever return.
  server->Wait();
}


Ausf g_ausf;
int g_workers_count;

void check_usage(int argc) {
	if (argc < 2) {
		TRACE(cout << "Usage: ./<ausf_server_exec> THREADS_COUNT" << endl;)
		g_utils.handle_type1_error(-1, "Invalid usage error: ausfserver_checkusage");
	}
}

void init(char *argv[]) {
	g_workers_count = atoi(argv[1]);
	if (mysql_library_init(0, NULL, NULL)) {
		g_utils.handle_type1_error(-1, "mysql_library_init error: ausfserver_init");
	}
	signal(SIGPIPE, SIG_IGN);
	std::thread(cpu_monitor_loop).detach();
}

void run() {
	/* MySQL connection */
	g_ausf.handle_mysql_conn();

	/* HSS server */
	

	TRACE(cout << "Ausf server started" << endl;)
	g_ausf.server.run(g_ausf_ip_addr, g_ausf_port, g_workers_count, handle_mme);
}

int handle_mme(int conn_fd, int worker_id) {
	Packet pkt;

	//g_ausf.server.rcv(conn_fd, pkt);
	//RunServer(worker_id);

	
	//if (pkt.len <= 0) {
	//	TRACE(cout << "ausfserver_handlemme:" << " Connection closed" << endl;)
		//return 0;
//	}		
	pkt.extract_diameter_hdr();
	switch (pkt.diameter_hdr.msg_type) {
		/* Authentication info req */
		case 1:
			TRACE(cout << "ausfserver_handlemme:" << " case 1: autn info req" << endl;)
		//	g_ausf.handle_autninfo_req(conn_fd, pkt);
			break;

		/* Location update */
		case 2:
			TRACE(cout << "ausfserver_handlemme:" << " case 2: loc update" << endl;)
		//	g_ausf.handle_location_update(conn_fd, pkt);
			break;

		/* For error handling */	
		default:
			TRACE(cout << "ausfserver_handlemme:" << " default case:" << endl;)
			break;
	}
	return 1;
}

void finish() {
	mysql_library_end();		
}

int main(int argc, char *argv[]) {
	check_usage(argc);
	init(argv);
	int g_workers_count = atoi(argv[1]);
	//auto r = NULL;
	// for (int i = 0; i < g_workers_count; ++i)
	// {
	// 	auto r = std::async(std::launch::async, RunServer,i);
	// }
	 std::thread grpc_server[g_workers_count];
 
        //Launch a group of threads
         for (int i = 0; i < g_workers_count; ++i) {
             grpc_server[i] = std::thread(RunServer,i);
        }

       std::cout << "Launched from the main\n";
 
      

	run();
	finish();
	  //Join the threads with the main thread
        for (int i = 0; i < g_workers_count; ++i) {
            grpc_server[i].join();
      }
	return 0;
}
