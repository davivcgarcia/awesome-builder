using System;
using System.Net.Http;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using dotnet_frontend.Models;
using Amazon.XRay.Recorder.Handlers.System.Net;

namespace dotnet_frontend.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        static readonly HttpClient client = new HttpClient(new HttpClientXRayTracingHandler(new HttpClientHandler()));

        public HomeController(ILogger<HomeController> logger)
        {
            _logger = logger;
        }

        public IActionResult Index()
        {
            return View();
        }

        public async Task<IActionResult> Random()
        {
            string url = Environment.GetEnvironmentVariable("IMAGE_BACKEND");
            string responseBody = await client.GetStringAsync(url);
            dynamic tmp = JsonConvert.DeserializeObject(responseBody);
            ViewData["imageURL"] = (string)tmp.imageUrl;
            return View();
        }

        public async Task<IActionResult> Favorite()
        {
            string url = Environment.GetEnvironmentVariable("FAVORITE_BACKEND");
            string responseBody = await client.GetStringAsync(url);
            dynamic tmp = JsonConvert.DeserializeObject(responseBody);
            Console.WriteLine(tmp);
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
