import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Wind, Droplets, AlertCircle, Shield, Sparkles, TrendingUp, Heart } from "lucide-react";
import { EASE } from "@/lib/aero/ui";

export const Route = createFileRoute("/learn")({
  component: LearnPage,
});

const pollutantCards = [
  {
    name: "PM2.5",
    fullName: "Fine Particulate Matter",
    value: "<2.5μm",
    description: "Tiny particles that penetrate deep into lungs and bloodstream",
    sources: "Vehicle exhaust, industrial emissions, wildfires, cooking smoke",
    health: "Respiratory diseases, heart problems, reduced lung function",
    color: "from-rose-500/20 to-pink-600/20",
    borderColor: "border-rose-500/30",
    icon: <Wind size={24} />,
    iconColor: "text-rose-400"
  },
  {
    name: "PM10",
    fullName: "Coarse Particulate Matter",
    value: "<10μm",
    description: "Larger particles visible as dust or haze",
    sources: "Dust storms, construction sites, pollen, mold spores",
    health: "Eye, nose, throat irritation, aggravates respiratory conditions",
    color: "from-orange-500/20 to-amber-600/20",
    borderColor: "border-orange-500/30",
    icon: <Droplets size={24} />,
    iconColor: "text-orange-400"
  },
  {
    name: "NO₂",
    fullName: "Nitrogen Dioxide",
    value: "ppb",
    description: "Reddish-brown gas that inflames airways",
    sources: "Vehicle emissions, power plants, industrial processes",
    health: "Asthma attacks, reduced immunity to lung infections",
    color: "from-yellow-500/20 to-orange-600/20",
    borderColor: "border-yellow-500/30",
    icon: <AlertCircle size={24} />,
    iconColor: "text-yellow-400"
  },
  {
    name: "O₃",
    fullName: "Ground-level Ozone",
    value: "ppb",
    description: "Forms when pollutants react with sunlight",
    sources: "Not directly emitted—secondary pollutant from NOx + VOCs",
    health: "Lung tissue damage, triggers asthma, reduces lung function",
    color: "from-cyan-500/20 to-blue-600/20",
    borderColor: "border-cyan-500/30",
    icon: <Sparkles size={24} />,
    iconColor: "text-cyan-400"
  },
  {
    name: "SO₂",
    fullName: "Sulfur Dioxide",
    value: "ppb",
    description: "Colorless gas with sharp smell",
    sources: "Fossil fuel combustion, volcanic eruptions, industrial facilities",
    health: "Breathing difficulties, especially for asthmatics",
    color: "from-purple-500/20 to-indigo-600/20",
    borderColor: "border-purple-500/30",
    icon: <Wind size={24} />,
    iconColor: "text-purple-400"
  },
  {
    name: "CO",
    fullName: "Carbon Monoxide",
    value: "ppm",
    description: "Odorless, colorless gas that reduces oxygen delivery",
    sources: "Incomplete combustion of fossil fuels, vehicle emissions",
    health: "Headaches, dizziness, reduced oxygen to organs",
    color: "from-red-500/20 to-rose-600/20",
    borderColor: "border-red-500/30",
    icon: <Heart size={24} />,
    iconColor: "text-red-400"
  }
];

const protectionStrategies = [
  {
    level: "Good",
    range: "0-50",
    color: "from-emerald-500/20 to-green-600/20",
    borderColor: "border-emerald-500/30",
    advice: "Air quality is excellent. Perfect for all outdoor activities.",
    actions: ["Enjoy outdoor exercise", "Open windows for fresh air", "No special precautions needed"]
  },
  {
    level: "Moderate",
    range: "51-100",
    color: "from-yellow-500/20 to-amber-600/20",
    borderColor: "border-yellow-500/30",
    advice: "Acceptable for most. Sensitive groups may experience minor effects.",
    actions: ["Unusually sensitive: consider reducing prolonged outdoor exertion", "Monitor symptoms", "Safe routes recommended"]
  },
  {
    level: "Unhealthy for Sensitive Groups",
    range: "101-150",
    color: "from-orange-500/20 to-red-600/20",
    borderColor: "border-orange-500/30",
    advice: "Sensitive groups may experience health effects.",
    actions: ["Wear N95 masks outdoors", "Reduce prolonged outdoor activities", "Use safe routes", "Close windows, use air purifier"]
  },
  {
    level: "Unhealthy",
    range: "151-200",
    color: "from-red-500/20 to-rose-600/20",
    borderColor: "border-red-500/30",
    advice: "Everyone may begin to experience health effects.",
    actions: ["Everyone: avoid outdoor exertion", "Sensitive groups: stay indoors", "N95 masks required if going out", "Air purifiers essential"]
  },
  {
    level: "Very Unhealthy",
    range: "201-300",
    color: "from-purple-500/20 to-violet-600/20",
    borderColor: "border-purple-500/30",
    advice: "Health alert: everyone may experience serious effects.",
    actions: ["Stay indoors", "Avoid all outdoor activities", "N95 masks essential", "Seek medical help if experiencing symptoms"]
  }
];

function LearnPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="relative overflow-hidden border-b border-white/5"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="relative mx-auto max-w-7xl px-6 py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-sm tracking-[0.2em] uppercase text-primary mb-4"
          >
            ◆ AIR QUALITY EDUCATION
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-5xl md:text-7xl font-light tracking-tight mb-6"
          >
            Understanding the air
            <br />
            <span className="text-primary italic">you breathe.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-lg text-muted-foreground max-w-2xl leading-relaxed"
          >
            A comprehensive guide to air pollutants, health impacts, and protection
            strategies—knowledge to help you make informed decisions about your health.
          </motion.p>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-16">
        {/* Pollutants Section */}
        <section>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-8"
          >
            <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-3">
              Major <span className="text-primary italic">Pollutants</span>
            </h2>
            <p className="text-muted-foreground">
              Six primary air pollutants and their health effects
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pollutantCards.map((pollutant, i) => (
              <motion.div
                key={pollutant.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.1 }}
                className={`group relative overflow-hidden rounded-2xl border ${pollutant.borderColor} bg-gradient-to-br ${pollutant.color} backdrop-blur-xl`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent" />
                <div className="relative p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-2xl font-bold tracking-tight">{pollutant.name}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                        {pollutant.value}
                      </div>
                    </div>
                    <div className={`${pollutant.iconColor}`}>
                      {pollutant.icon}
                    </div>
                  </div>

                  <div className="text-sm font-medium">{pollutant.fullName}</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {pollutant.description}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                        Sources
                      </div>
                      <div className="text-xs text-foreground/80">{pollutant.sources}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                        Health Impact
                      </div>
                      <div className="text-xs text-foreground/80">{pollutant.health}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Protection Strategies */}
        <section>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-3">
              Protection <span className="text-primary italic">Strategies</span>
            </h2>
            <p className="text-muted-foreground">
              What to do at different AQI levels
            </p>
          </motion.div>

          <div className="space-y-4">
            {protectionStrategies.map((strategy, i) => (
              <motion.div
                key={strategy.level}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className={`group relative overflow-hidden rounded-2xl border ${strategy.borderColor} bg-gradient-to-r ${strategy.color} backdrop-blur-xl`}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/[0.03] to-transparent" />
                <div className="relative p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                    <div className="flex items-baseline gap-4">
                      <div className="text-2xl font-bold">{strategy.level}</div>
                      <div className="text-sm text-muted-foreground uppercase tracking-wider">
                        AQI {strategy.range}
                      </div>
                    </div>
                    <div className="text-sm font-medium italic">{strategy.advice}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {strategy.actions.map((action, j) => (
                      <div
                        key={j}
                        className="flex items-start gap-2 text-sm rounded-lg border border-white/5 bg-black/20 px-3 py-2"
                      >
                        <Shield size={14} className="text-primary mt-0.5 flex-shrink-0" />
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Key Statistics */}
        <section>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-3">
              The <span className="text-primary italic">Impact</span>
            </h2>
            <p className="text-muted-foreground">
              Global air pollution statistics
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { value: "7M+", label: "Premature deaths annually", subtext: "From air pollution worldwide" },
              { value: "91%", label: "World population", subtext: "Breathes unsafe air" },
              { value: "2-3yrs", label: "Life expectancy loss", subtext: "In high-pollution cities" },
              { value: "$5T", label: "Economic cost", subtext: "Healthcare & lost productivity" }
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-purple-500/10 backdrop-blur-xl"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent" />
                <div className="relative p-6">
                  <div className="text-4xl font-bold text-primary mb-2 tracking-tight">
                    {stat.value}
                  </div>
                  <div className="text-sm font-medium mb-1">{stat.label}</div>
                  <div className="text-xs text-muted-foreground">{stat.subtext}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Daily Tips */}
        <section>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/5 to-transparent backdrop-blur-xl p-8"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
            <div className="relative">
              <h3 className="text-2xl font-light tracking-tight mb-6">
                Daily <span className="text-primary italic">Habits</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  "Check AQI before planning outdoor activities",
                  "Schedule exercise for early morning when AQI is lower",
                  "Keep indoor plants that filter air naturally",
                  "Change HVAC filters regularly",
                  "Use exhaust fans when cooking",
                  "Walk on tree-lined streets when possible",
                  "Support clean energy and public transport policies",
                  "Avoid burning candles or incense indoors"
                ].map((tip, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                    className="flex items-start gap-3 text-sm"
                  >
                    <TrendingUp size={16} className="text-primary mt-0.5 flex-shrink-0" />
                    <span>{tip}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>
      </div>

      {/* Bottom padding */}
      <div className="h-16" />
    </div>
  );
}
